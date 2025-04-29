const DomainSchema = require("../domain.js");
const dotenv = require("dotenv");
dotenv.config();
async function sendtg(domain, message) {
  const user = await DomainSchema.find({ domain });
  const botToken = process.env.BOT_TOKEN;

  try {
    user.forEach(async (user) => {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${
          user.userId
        }&text=${encodeURIComponent(message)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`Уведомление отправлено: ${message}`);
    });
  } catch (error) {
    console.error("Ошибка при отправке в Telegram:", error);
  }
}

async function sendTelegramMessage(domain, message) {
  const botToken = process.env.BOT_TOKEN;

  while (true) {
    const user = await DomainSchema.findOneAndUpdate(
      { domain, displayed: false },
      { $set: { displayed: true } }
    );

    if (!user) break; // Нет больше необработанных пользователей

    if (!botToken || !user?.userId) {
      console.error("Не указаны BOT_TOKEN или userId");
      continue;
    }

    try {
      await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${
          user.userId
        }&text=${encodeURIComponent(message)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log(
        `📨 Уведомление отправлено пользователю ${user.userId} для домена ${domain}: ${message}`
      );
    } catch (err) {
      console.error("Ошибка при отправке Telegram:", err);
    }
  }
}

module.exports = {
  sendtg,
  sendTelegramMessage,
};
