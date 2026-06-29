import { CatchBot } from "../../database/models/catchBot.js";
import { Sequelize, DataTypes } from "@sequelize/core";
import { PostgresDialect } from "@sequelize/postgres";

import {
  host,
  port,
  username,
  password,
  database,
} from "../constants/constants.js";

const sequelize = new Sequelize({
  dialect: PostgresDialect,
  host: host,
  port: port,
  user: username,
  password: password,
  database: database,
});

const catchBot = CatchBot(sequelize, DataTypes);

export const saveCatchBuyOrSell = async ({
  mint,
  buyOrSellTime,
  tokenAmount,
  pnlPct,
}) => {
  try {
    await catchBot.create({
      mint: mint,
      buy_or_sell_time: buyOrSellTime ?? new Date(),
      token_amount: tokenAmount,
      pnl_pct: pnlPct ?? null,
    });
  } catch (error) {
    console.error("Error saving catch buy or sell:", error);
  }
};

// saveCatchBuyOrSell({
//   mint: "mint",
//   buyOrSellTime: new Date(),
//   tokenAmount: 0,
//   pnlPct: null,
// });
