const express = require("express");

const dotenv = require("dotenv");
dotenv.config();
const pLimit = require("p-limit");
const DomainSchema = require("./domain.js");
const { default: mongoose } = require("mongoose");
const checkDomains = require("./utils/checkDomains.js");
const checkDomainStatus = require("./utils/checkDomains.js");
const googleRouter = require("./routes/google.js");
const domainRouter = require("./routes/domain.js");

const app = express();
const port = process.env.PORT || 8080;

app.use("/", googleRouter);
app.use("/", domainRouter);

mongoose
  .connect(process.env.DB_URI, {})
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
