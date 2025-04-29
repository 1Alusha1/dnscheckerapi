const dns = require("dns");
const net = require("net");
const tls = require("tls");
const pLimit = require("p-limit");
const { sendTelegramMessage } = require("./tgMessages");
const DomainSchema = require('../domain.js')
const providers = {
  Yandex: "77.88.8.8",
  MTS: ["134.17.4.251"],
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
      let msg = "";

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
        msg = `❌ SSL: ${domain} — сертификат просрочен (срок: ${cert.valid_from} - ${cert.valid_to})`;
        socket.end();
        return resolve({ valid: false, msg });
      }

      msg = `✅ SSL: ${domain} — сертификат действителен до ${cert.valid_to}`;
      socket.end();
      resolve({ valid: true, msg });
    });

    socket.on("error", (err) => {
      resolve({
        valid: false,
        msg: `❌ SSL: ${domain} — ошибка SSL-соединения: ${err.message}`,
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
  let msg = "";
  let isAvailable = true;

  const socketCheck = await new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(3000);

    socket.on("connect", () => {
      socket.destroy();
      msg += `✅ Сокет: ${domain} доступен\n`;
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      msg += `❌ Сокет: ${domain} недоступен (таймаут)\n`;
      resolve(false);
    });

    socket.on("error", (err) => {
      socket.destroy();
      msg += `❌ Сокет: ${domain} недоступен (ошибка: ${err.message})\n`;
      resolve(false);
    });

    try {
      socket.connect(443, domain);
    } catch (err) {
      msg += `❌ Ошибка сокет-подключения к ${domain}: ${err.message}\n`;
      resolve(false);
    }
  });

  if (!socketCheck) {
    isAvailable = false;
    return { isAvailable, msg };
  }

  const sslCheck = await checkSSL(domain);
  msg += sslCheck.msg + "\n";

  if (!sslCheck.valid) {
    isAvailable = false;
    return { isAvailable, msg };
  }

  for (const [name, servers] of Object.entries(providers)) {
    const serverList = Array.isArray(servers) ? servers : [servers];
    let providerSuccess = false;

    for (const server of serverList) {
      try {
        await resolveWithServer(domain, server);
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

  return { isAvailable, msg };
}

async function checkDomains() {
  const domains = await DomainSchema.find();
  const limit = pLimit(10); // максимум 10 параллельных задач

  const checks = domains.map(({ domain }) =>
    limit(async () => {
      const { isAvailable, msg } = await checkDomainStatus(domain);
      if (!isAvailable) {
        await sendTelegramMessage(domain, msg);
      }
    })
  );

  await Promise.allSettled(checks);
  console.log("✅ Проверка доменов завершена.");
}

module.exports = {checkDomains,checkDomainStatus};