const express = require('express');
const dns = require('dns');
const net = require('net');
const db = require('./db.js');
const dotenv = require('dotenv');
dotenv.config();
const pLimit = require('p-limit');
const DomainSchema = require('./domain.js');
const { default: mongoose } = require('mongoose');

const app = express();
const port = process.env.PORT || 8080;

async function sendTelegramMessage(domain, dnsFlag = false, msg = '') {
  const user = await DomainSchema.findOne({ domain });
  const botToken = process.env.BOT_TOKEN;

  if (!botToken || !user?.userId) {
    console.error('Не указаны BOT_TOKEN или userId');
    return;
  }

  if (user.displayed) return;

  const message = !dnsFlag ? `⚠️ Домен ${domain} недоступен!` : msg;

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

    await DomainSchema.findOneAndUpdate(
      { domain },
      { displayed: true },
      { new: true }
    );

    console.log(`📨 Уведомление отправлено: ${message}`);
  } catch (err) {
    console.error('Ошибка при отправке Telegram:', err);
  }
}

async function checkDomainAvailability(domain) {
  return new Promise(async (resolve) => {
    const socket = new net.Socket();
    const port = 443;
    let resolved = false;

    socket.setTimeout(3000);

    const finish = async (isAvailable, logMsg) => {
      if (resolved) return;
      resolved = true;

      try {
        const current = await DomainSchema.findOne({ domain });
        if (!current) return;

        if (current.active !== isAvailable) {
          await DomainSchema.findOneAndUpdate(
            { domain },
            {
              active: isAvailable,
              displayed: isAvailable ? false : current.displayed,
            },
            { new: true }
          );
        }

        console.log(logMsg);
        resolve({ isAvailable, logMsg });
      } catch (e) {
        console.error('Ошибка при обновлении MongoDB:', e);
        resolve({ isAvailable: false, logMsg: e.message });
      }
    };

    socket.on('connect', () => {
      socket.end();
      finish(true, `✅ Домен ${domain} доступен.`);
    });

    socket.on('timeout', () => {
      socket.destroy();
      finish(false, `❌ Домен ${domain} недоступен (таймаут).`);
    });

    socket.on('error', (err) => {
      socket.destroy();
      finish(false, `❌ Домен ${domain} недоступен (ошибка: ${err.message}).`);
    });

    try {
      socket.connect(port, domain);
    } catch (err) {
      finish(false, `❌ Ошибка подключения к ${domain}: ${err.message}`);
    }
  });
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

async function checkDomainByDNS(domain) {
  let msg = '';
  let success = true;

  for (const [name, servers] of Object.entries(providers)) {
    const serverList = Array.isArray(servers) ? servers : [servers];

    let providerSuccess = false;
    for (const server of serverList) {
      try {
        const addresses = await resolveWithServer(domain, server);
        console.log(
          `✅ ${domain} доступен через ${name} (${server}): ${addresses.join(
            ', '
          )}`
        );
        msg += `\n✅ Домен: ${domain} доступен  через ${name}`;
        providerSuccess = true;
        break;
      } catch (err) {
        console.log(
          `⚠️ ${domain} не доступен через ${name} (${server}): ${
            err.code || err.message
          }`
        );
      }
    }

    if (!providerSuccess) {
      success = false;
      msg += `\n❌ Домен: ${domain} не доступен через ${name}`;
    }
  }

  return { success, msg };
}

async function checkDomains() {
  const domains = await DomainSchema.find();
  const limit = pLimit(10);

  const checks = domains.map(({ domain }) =>
    limit(async () => {
      const { isAvailable } = await checkDomainAvailability(domain);
      const { success, msg } = await checkDomainByDNS(domain);
      if (!success) await sendTelegramMessage(domain, true, msg);
      if (!isAvailable) await sendTelegramMessage(domain);
    })
  );

  await Promise.allSettled(checks);
  console.log('✅ Проверка доменов завершена.');
}

app.get('/check-domains', async (req, res) => {
  try {
    await checkDomains();
    res.status(200).json({ message: '✅ Проверка доменов завершена' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '❌ Ошибка при проверке доменов' });
  }
});

app.get('/check-own/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const userDomains = await DomainSchema.find({ userId });
    const limit = pLimit(10);
    const results = [];

    const checks = userDomains.map(({ domain }) =>
      limit(async () => {
        const { isAvailable, logMsg } = await checkDomainAvailability(domain);
        const { success, msg } = await checkDomainByDNS(domain);

        const fullMessage = `${logMsg}\n${msg}`;

        results.push({
          domain,
          isAvailable,
          dnsSuccess: success,
          message: fullMessage,
        });

        try {
          await fetch(
            `https://api.telegram.org/bot${
              process.env.BOT_TOKEN
            }/sendMessage?chat_id=${userId}&text=${encodeURIComponent(
              fullMessage
            )}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }
          );

          console.log(`📨 Уведомление для ${userId}: ${fullMessage}`);
        } catch (err) {
          console.error('Ошибка отправки Telegram для пользователя:', err);
        }
      })
    );

    await Promise.allSettled(checks);
    res.status(200).json({ message: '✅ Проверка доменов завершена', results });
  } catch (error) {
    console.error('Ошибка при проверке пользовательских доменов:', error);
    res
      .status(500)
      .json({ error: '❌ Ошибка при проверке пользовательских доменов' });
  }
});

app.get('/check-one/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    const availability = await checkDomainAvailability(domain);
    const dnsResult = await checkDomainByDNS(domain);
    res.status(200).json({ domain, ...availability, ...dnsResult });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '❌ Ошибка при проверке домена' });
  }
});

app.get('/not-active', async (req, res) => {
  try {
    const records = await DomainSchema.find({ active: false });

    if (!records?.length) {
      return res.status(200).json({ message: '✅ Все домены работают' });
    }

    res.status(200).json({
      message: '❌ Есть недоступные домены',
      records,
      count: records.length,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: '❌ Ошибка при получении недоступных доменов' });
  }
});

mongoose
  .connect(process.env.DB_URI, {})
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
