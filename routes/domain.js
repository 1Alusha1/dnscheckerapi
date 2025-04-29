const { Router } = require("express");
const pLimit = require("p-limit");
const DomainSchema = require("../domain.js");
const { checkDomainStatus, checkDomains } = require("../utils/checkDomains.js");
const router = Router();

router.get("/check-domains", async (req, res) => {
  try {
    await checkDomains();
    res.status(200).send("Domains checked");
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send("Error occurred while checking domains");
  }
});

router.get("/check-own/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const userDomains = await DomainSchema.find({ userId });
    const limit = pLimit(10); // максимум 10 параллельных задач

    const checks = userDomains.map(({ domain }) =>
      limit(async () => {
        const { isAvailable, msg } = await checkDomainStatus(domain);

        try {
          await fetch(
            `https://api.telegram.org/bot${
              process.env.BOT_TOKEN
            }/sendMessage?chat_id=${userId}&text=${encodeURIComponent(msg)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
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
          console.error("Ошибка отправки Telegram для пользователя:", err);
        }
      })
    );

    await Promise.allSettled(checks);
    res.status(200).send("✅ Проверка доменов завершена");
  } catch (error) {
    console.error("Ошибка при проверке пользовательских доменов:", error);
    res.status(500).send("❌ Ошибка при проверке пользовательских доменов");
  }
});

router.get("/check-one/:domain", async (req, res) => {
  try {
    const { domain } = req.params;

    const { isAvailable, msg } = await checkDomainStatus(domain);

    res.status(200).json({ isAvailable, msg });
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send("Error occurred while checking domain");
  }
});

router.get("/not-active", async (req, res) => {
  try {
    const records = await DomainSchema.find({ active: false });

    if (!records) {
      return res.status(200).send("Every domain works");
    }

    res.status(200).json({ records, count: records.length });
  } catch (error) {
    if (error) console.log(error);
    res.status(500).send("Error occurred while getting not active domains");
  }
});

module.exports = router;
