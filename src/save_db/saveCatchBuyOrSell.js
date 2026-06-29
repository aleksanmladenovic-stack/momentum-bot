import { CatchBot } from "../../database/models/index.js";
import { Sequelize, DataTypes } from "@sequelize/core";
import { PostgresDialect } from "@sequelize/postgres";

import {
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DB,
} from "../constants/constants.js";

const sequelize = new Sequelize({
  dialect: PostgresDialect,
  host: PG_HOST,
  port: PG_PORT,
  username: PG_USER,
  password: PG_PASSWORD,
  database: PG_DB,
});

const catchBot = CatchBot(sequelize, DataTypes);

export const saveCatchBuyOrSell = async ({
  mint,
  buyOrSellTime,
  tokenAmount,
  solAmount,
  pnlPct,
}) => {
  try {
    await catchBot.create({
      mint: mint,
      buyOrSellTime: buyOrSellTime ?? new Date(),
      tokenAmount: tokenAmount,
      solAmount: solAmount,
      pnlPct: pnlPct ?? null,
    });
  } catch (error) {
    console.error("Error saving catch buy or sell:", error);
  }
};
