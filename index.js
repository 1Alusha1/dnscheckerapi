const express = require('express');
const dns = require('dns');
const net = require('net');
const tls = require('tls');

const dotenv = require('dotenv');
dotenv.config();
const pLimit = require('p-limit');
const DomainSchema = require('./domain.js');
const { default: mongoose } = require('mongoose');

const app = express();
const port = process.env.PORT || 8080;

async function sendTelegramMessage(domain, message) {
  const botToken = process.env.BOT_TOKEN;

  while (true) {
    const user = await DomainSchema.findOneAndUpdate(
      { domain, displayed: false },
      { $set: { displayed: true } }
    );

    if (!user) break; // Нет больше необработанных пользователей

    if (!botToken || !user?.userId) {
      console.error('Не указаны BOT_TOKEN или userId');
      continue;
    }

    try {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${
          user.userId
        }&text=${encodeURIComponent(message)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      console.log(
        `📨 Уведомление отправлено пользователю ${user.userId} для домена ${domain}: ${message}`
      );
    } catch (err) {
      console.error('Ошибка при отправке Telegram:', err);
    }
  }
}

const providers = {
  Yandex: '77.88.8.8',
  MTS: ['134.17.4.251'],
};

async function resolveWithServer(domain, server) {
  const resolver = new dns.Resolver();
  resolver.setServers([server]);

  return new Promise((resolve, reject) => {
    resolver.resolve4(domain, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

const checkSafe = async (domain) => {
  const dto = {
    threatInfo: {
      threatTypes: [
        'MALWARE',
        'SOCIAL_ENGINEERING',
        'UNWANTED_SOFTWARE',
        'POTENTIALLY_HARMFUL_APPLICATION',
      ],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url: domain }],
    },
  };

  const response = await fetch(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.GOOGLE_APIKEY}`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
      headers: { application: 'json' },
    }
  );
  const data = await response.json();

  if (response.ok) {
    const types = {
      MALWARE: 'ЗЛОУМЫШЛЕННИКИ',
      SOCIAL_ENGINEERING: 'СОЦИАЛЬНАЯ ИНЖЕНЕРИЯ',
      UNWANTED_SOFTWARE: 'НЕЖЕЛАТЕЛЬНОЕ ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ',
      POTENTIALLY_HARMFUL_APPLICATION: 'ПОТЕНЦИАЛЬНО ВРЕДНОЕ ПРИМЕНЕНИЕ',
    };

    if (!Object.keys(data).length) {
      return {
        msg: `✅ Google Safe: ${domain} считаеться безопасным`,
        isAvailable: true,
      };
    }

    const type = data.matches.reduce((acc, type) => {
      acc += types[type.threatType] + ' ';
      return acc;
    }, '');

    return {
      msg: `❌ Google Safe: ${domain} помечен как ${type} `,
      isAvailable: false,
    };
  }
  if (response.status === 429) {
    return {
      msg: '⚠️ Google Safe: Превышен лимит проверок',
      isAvailable: false,
    };
  }
};

async function checkSSL(domain) {
  return new Promise((resolve) => {
    const options = {
      host: domain,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
    };

    const socket = tls.connect(options, () => {
      const cert = socket.getPeerCertificate();
      let msg = '';

      if (!cert || !Object.keys(cert).length) {
        msg = `❌ SSL: ${domain} — сертификат не получен`;
        socket.end();
        return resolve({ valid: false, msg });
      }

      // Проверка срока действия
      const now = new Date();
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);

      if (now < validFrom || now > validTo) {
        msg = `❌ SSL: ${domain} — сертификат просрочен`;
        socket.end();
        return resolve({ valid: false, msg });
      }

      msg = `✅ SSL: ${domain} — сертификат действителен до ${cert.valid_to}`;
      socket.end();
      resolve({ valid: true, msg });
    });

    socket.on('error', (err) => {
      resolve({
        valid: false,
        msg: `❌ SSL: ${domain} — ошибка SSL-соединения`,
      });
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve({
        valid: false,
        msg: `❌ SSL: ${domain} — таймаут SSL-соединения`,
      });
    });
  });
}

async function checkDomainStatus(domain) {
  let msg = '';
  let isAvailable = true;

  const socketCheck = await new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(3000);

    socket.on('connect', () => {
      socket.destroy();
      msg += `✅ Сокет: ${domain} доступен\n`;
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      msg += `❌ Сокет: ${domain} недоступен (таймаут)\n`;
      resolve(false);
    });

    socket.on('error', (err) => {
      socket.destroy();
      msg += `❌ Сокет: ${domain} недоступен \n`;
      resolve(false);
    });

    try {
      socket.connect(443, domain);
    } catch (err) {
      msg += `❌ Ошибка сокет-подключения к ${domain}\n`;
      resolve(false);
    }
  });

  const googleSafe = await checkSafe(domain);
  msg += googleSafe.msg + '\n';

  const sslCheck = await checkSSL(domain);
  msg += sslCheck.msg + '\n';

  for (const [name, servers] of Object.entries(providers)) {
    const serverList = Array.isArray(servers) ? servers : [servers];
    let providerSuccess = false;

    for (const server of serverList) {
      try {
        await resolveWithServer(domain, server) 
        msg += `✅ DNS: ${domain} доступен через ${name} \n`;
        providerSuccess = true;
      } catch (err) {
        msg += `❌ DNS: ${domain} не доступен через ${name}\n`;
      }
    }
    if (!providerSuccess) {
      isAvailable = false;
    }
  }

  if (!socketCheck) {
    isAvailable = false;
    return { isAvailable, msg };
  }

  if (!googleSafe.isAvailable) {
    isAvailable = false;
    return { isAvailable, msg };
  }

  if (!sslCheck.valid) {
    isAvailable = false;
    return { isAvailable, msg };
  }
  return { isAvailable, msg };
}

async function checkDomains() {
  const domains = await DomainSchema.find();
  const limit = pLimit(10); // максимум 10 параллельных задач

  const checks = domains.map(({ domain }) =>
    limit(async () => {
      const { isAvailable, msg } = await checkDomainStatus(domain);
      console.log(msg);
      if (!isAvailable) {
        await sendTelegramMessage(domain, msg);
      }
    })
  );

  await Promise.allSettled(checks);
  console.log('✅ Проверка доменов завершена.');
}

app.get('/check-domains', async (req, res) => {
  try {
    await checkDomains();
    res.status(200).send('Domains checked');
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send('Error occurred while checking domains');
  }
});

app.get('/check-own/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const userDomains = await DomainSchema.find({ userId });
    const limit = pLimit(10); // максимум 10 параллельных задач

    const checks = userDomains.map(({ domain }) =>
      limit(async () => {
        const { isAvailable, msg } = await checkDomainStatus(domain);
        console.log(msg);
        try {
          await fetch(
            `https://api.telegram.org/bot${
              process.env.BOT_TOKEN
            }/sendMessage?chat_id=${userId}&text=${encodeURIComponent(msg)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }
          );

          if (!isAvailable) {
            await DomainSchema.updateMany(
              { domain },
              { displayed: false },
              { new: true }
            );
          }
          console.log(`📨 Уведомление для ${userId}: ${msg}`);
        } catch (err) {
          console.error('Ошибка отправки Telegram для пользователя:', err);
        }
      })
    );

    await Promise.allSettled(checks);
    res.status(200).send('✅ Проверка доменов завершена');
  } catch (error) {
    console.error('Ошибка при проверке пользовательских доменов:', error);
    res.status(500).send('❌ Ошибка при проверке пользовательских доменов');
  }
});

app.get('/check-one/:domain', async (req, res) => {
  try {
    const { domain } = req.params;

    const { isAvailable, msg } = await checkDomainStatus(domain);

    res.status(200).json({ isAvailable, msg });
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send('Error occurred while checking domain');
  }
});

app.get('/not-active', async (req, res) => {
  try {
    const records = await DomainSchema.find({ active: false });

    if (!records) {
      return res.status(200).send('Every domain works');
    }

    res.status(200).json({ records, count: records.length });
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send('Error occurred while getting not active domains');
  }
});

mongoose
  .connect(process.env.DB_URI, {})
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
