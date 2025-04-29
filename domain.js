const dotenv = require("dotenv");
const mongoose = require("mongoose");
dotenv.config();
const Schema = mongoose.Schema;

const DomainSchema = new Schema({
  domain: String,
  userId: Number,
  displayed: {
    type: Boolean,
    default: false,
  },
  active: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model("Domain", DomainSchema);
