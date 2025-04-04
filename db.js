const dotenv = require("dotenv");
const mongoose = require("mongoose");
dotenv.config();

module.exports = async function db() {
  await mongoose.connect(process.env.DB_URI);
};
