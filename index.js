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

async function sendTelegramMessage(domain) {
  const user = await DomainSchema.findOne({ domain });
  const botToken = process.env.BOT_TOKEN;

  if (!botToken || !user?.userId) {
    console.error('Не указаны BOT_TOKEN или userId');
    return;
  }

  if (user.displayed) return;

  const message = `⚠️ Домен ${domain} недоступен!`;

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
  const port = 443;
  const socket = new net.Socket();
  let resolved = false;

  socket.setTimeout(3000);

  const dnsCheck = checkDomainByDNS(domain); // запустим параллельно

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
    } catch (e) {
      console.error('Ошибка при обновлении MongoDB:', e);
    }
  };

  socket.on('connect', () => {
    socket.end();
    finish(true, `✅ Домен ${domain} доступен (по порту).`);
  });

  socket.on('timeout', () => {
    socket.destroy();
    finish(false, `❌ Домен ${domain} недоступен (таймаут порта).`);
  });

  socket.on('error', (err) => {
    socket.destroy();
    finish(
      false,
      `❌ Домен ${domain} недоступен (ошибка порта: ${err.message}).`
    );
  });

  try {
    socket.connect(port, domain);
  } catch (err) {
    finish(false, `❌ Ошибка подключения к ${domain}: ${err.message}`);
  }

  try {
    await dnsCheck;
  } catch (e) {
  }

  return new Promise((resolve) => {
    // таймаут на всякий случай
    setTimeout(() => {
      if (!resolved) {
        socket.destroy();
        finish(
          false,
          `❌ Домен ${domain} не дал ответ по порту и таймаут вышел.`
        );
      }
      resolve({ isAvailable: resolved }); // результат с учетом порта
    }, 4000);
  });
}

async function checkDomains() {
  const domains = await DomainSchema.find();
  const limit = pLimit(10); // максимум 10 параллельных задач

  const checks = domains.map(({ domain }) =>
    limit(async () => {
      const { isAvailable } = await checkDomainAvailability(domain);
      const {} = await checkDomainByDNS(domain);

      if (!isAvailable) {
        console.log(domain + " ins't work")
        await sendTelegramMessage(domain);
      }
    })
  );

  await Promise.allSettled(checks);
  console.log('✅ Проверка доменов завершена.');
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
  for (const [name, servers] of Object.entries(providers)) {
    const serverList = Array.isArray(servers) ? servers : [servers];

    let success = false;

    for (const server of serverList) {
      try {
        const addresses = await resolveWithServer(domain, server);
        console.log(
          `✅ ${domain} доступен через ${name} (${server}): ${addresses.join(
            ', '
          )}`
        );
        success = true;
        break; // как только один из серверов сработал — достаточно
      } catch (err) {
        // Переходим к следующему серверу, если есть
        console.log(
          `⚠️ ${domain} не доступен через ${name} (${server}): ${
            err.code || err.message
          }`
        );
      }
    }

    if (!success) {
      console.log(
        `❌ ${domain} не доступен через ${name}: все серверы не ответили`
      );
    }
  }
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
    const limit = pLimit(10); // ограничим до 10 параллельных проверок

    const checks = userDomains.map(({ domain }) =>
      limit(async () => {
        const { isAvailable } = await checkDomainAvailability(domain);
        const message = !isAvailable
          ? `⚠️ Домен ${domain} недоступен!`
          : `✅ Домен ${domain} доступен.`;

        try {
          await fetch(
            `https://api.telegram.org/bot${
              process.env.BOT_TOKEN
            }/sendMessage?chat_id=${userId}&text=${encodeURIComponent(
              message
            )}`,
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
          console.log(`📨 Уведомление для ${userId}: ${message}`);
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
    const data = await checkDomainAvailability(domain);
    console.log(data);
    res.status(200).send('Domains checked');
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
