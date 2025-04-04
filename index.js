const express = require("express");
const dns = require("dns");
const net = require("net");
const db = require("./db.js");
const dotenv = require("dotenv");
dotenv.config();
const DomainSchema = require("./domain.js");

db().catch((err) => console.log(err));

const app = express();
const port = process.env.PORT || 8080;

async function sendTelegramMessage(domain, isAvailable) {
  let message = `⚠️ Домен ${domain} недоступен!`;

  const user = await DomainSchema.findOne({ domain });

  const userId = user.userId;
  const botToken = process.env.BOT_TOKEN;

  if (!botToken || !userId) {
    console.error("Не указаны BOT_TOKEN или TG_USER_ID в .env");
    return;
  }
  if (!user.displayed) {
    try {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${userId}&text=${encodeURIComponent(
          message
        )}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      await DomainSchema.findOneAndUpdate(
        { domain },
        { displayed: true },
        { new: true }
      );
      console.log(`Уведомление отправлено: ${message}`);
    } catch (error) {
      console.error("Ошибка при отправке в Telegram:", error);
    }
  }
}

async function checkDomainAvailability(domain) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const port = 80;

    socket.setTimeout(3000);
    socket.on("connect", async () => {
      console.log(`✅ Домен ${domain} доступен.`);
      await DomainSchema.findOneAndUpdate(
        { domain },
        { active: true, displayed: false },
        { new: true }
      );
      socket.end();
      resolve({ isAvailable: true, message: `✅ Домен ${domain} доступен.` });
    });
    socket.on("timeout", async () => {
      console.log(`❌ Домен ${domain} недоступен (таймаут).`);
      console.log(`❌ Статус домена ${domain} изменен на неактивный`);
      await DomainSchema.findOneAndUpdate(
        { domain },
        { active: false },
        { new: true }
      );
      socket.destroy();
      resolve({
        isAvailable: false,
        message: `❌ Домен ${domain} недоступен (ошибка подключения).`,
      });
    });
    socket.on("error", async () => {
      console.log(`❌ Домен ${domain} недоступен (ошибка подключения).`);
      console.log(`❌ Статус домена ${domain} изменен на неактивный`);
      await DomainSchema.findOneAndUpdate(
        { domain },
        { active: false },
        { new: true }
      );
      socket.destroy();
      resolve({
        isAvailable: false,
        message: `❌ Домен ${domain} недоступен (ошибка подключения).`,
      });
    });
    socket.connect(port, domain);
  });
}

async function checkDomains() {
  const domains = await DomainSchema.find();

  for (const { domain } of domains) {
    const { isAvailable } = await checkDomainAvailability(domain);
    if (!isAvailable) {
      await sendTelegramMessage(domain);
    }
  }
}

app.get("/check-domains", async (req, res) => {
  try {
    await checkDomains();
    res.status(200).send("Domains checked");
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send("Error occurred while checking domains");
  }
});

app.get("/check-own/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const userDomains = await DomainSchema.find({ userId });

    for (const { domain } of userDomains) {
      const { message } = await checkDomainAvailability(domain);

      try {
        await fetch(
          `https://api.telegram.org/bot${
            process.env.BOT_TOKEN
          }/sendMessage?chat_id=${userId}&text=${encodeURIComponent(message)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        await DomainSchema.findOneAndUpdate(
          { domain },
          { displayed: false },
          { new: true }
        );
        console.log(`Уведомление отправлено: ${message}`);
      } catch (error) {
        console.error("Ошибка при отправке в Telegram:", error);
      }
    }
    res.status(200).send("Domains checked");
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send("Error occurred while checking own domains");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
