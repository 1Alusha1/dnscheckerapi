const { Router } = require("express");
const pLimit = require("p-limit");
const DomainSchema = require("../domain.js");
const { sendtg } = require("../utils/tgMessages.js");
const checkSafe = require("../utils/checkSafe.js");
const router = Router();

router.get("/google-safe", async (req, res) => {
  try {
    const domains = await DomainSchema.find();
    const limit = pLimit(10);
    console.log("✅ Проверка началась");

    const checks = domains.map(async ({ domain }) =>
      limit(async () => {
        const { isAvailable, msg } = await checkSafe(domain);
        if (!isAvailable) {
          sendtg(domain, msg);

          await DomainSchema.findOneAndUpdate(
            { domain },
            { displayed: true },
            { new: true }
          );
        }
      })
    );

    await Promise.allSettled(checks);
    console.log("✅ Проверка завершена");
    res.status(200).send("✅ Проверка завершена");
  } catch (err) {
    if (err) console.log(err);
    console.log("❌ Ошибка во время проверки", err.message);
    res.status(500).json({
      msg: "❌ Ошибка во время проверки",
      error: err.message,
    });
  }
});

router.get("/google-safe-own/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const ownDomains = await DomainSchema.find({ userId });
    console.log("✅ Проверка собственных доменов нвчалась");
    const limit = pLimit(10);

    const checks = ownDomains.map(({ domain }) =>
      limit(async () => {
        const { msg } = await checkSafe(domain);
        console.log(msg);

        await sendtg(domain, msg);

        await DomainSchema.findOneAndUpdate(
          { domain },
          { displayed: false },
          { new: true }
        );
      })
    );

    await Promise.allSettled(checks);
    console.log("✅ Проверка собственных доменов завершена");
    res.status(200).send("✅ Проверка завершена");
  } catch (err) {
    if (err) console.log(err);
    console.log("❌ Ошибка во время проверки собственных доменов", err.message);

    res.status(500).json({
      msg: "❌ Ошибка во время проверки собственных доменов",
      error: err.message,
    });
  }
});

module.exports = router;
