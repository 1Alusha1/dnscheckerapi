const checkSafe = async (domain) => {
  const dto = {
    threatInfo: {
      threatTypes: [
        "MALWARE",
        "SOCIAL_ENGINEERING",
        "UNWANTED_SOFTWARE",
        "POTENTIALLY_HARMFUL_APPLICATION",
      ],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url: domain }],
    },
  };

  const response = await fetch(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.GOOGLE_APIKEY}`,
    {
      method: "POST",
      body: JSON.stringify(dto),
      headers: { application: "json" },
    }
  );
  const data = await response.json();

  if (response.ok) {
    const types = {
      MALWARE: "ЗЛОУМЫШЛЕННИКИ",
      SOCIAL_ENGINEERING: "СОЦИАЛЬНАЯ ИНЖЕНЕРИЯ",
      UNWANTED_SOFTWARE: "НЕЖЕЛАТЕЛЬНОЕ ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ",
      POTENTIALLY_HARMFUL_APPLICATION: "ПОТЕНЦИАЛЬНО ВРЕДНОЕ ПРИМЕНЕНИЕ",
    };

    if (!Object.keys(data).length) {
      return {
        msg: `✅ Google Safe: ${domain} считаеться безопасным`,
        isAvailable: true,
      };
    }

    const type = data.matches.reduce((acc, type) => {
      acc += types[type.threatType] + " ";
      return acc;
    }, "");

    return {
      msg: `❌ Google Safe: ${domain} помечен как ${type} `,
      isAvailable: false,
    };
  }
  if (response.status === 429) {
    return {
      msg: "⚠️ Google Safe: Превышен лимит проверок",
      isAvailable: false,
    };
  }
};

module.exports = checkSafe;
