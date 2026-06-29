"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("catchBot", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      mint: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      buy_or_sell_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      token_amount: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      pnl_pct: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
    });

    await queryInterface.addIndex("catchBot", ["mint"]);
    await queryInterface.addIndex("catchBot", ["buy_or_sell_time"]);
    await queryInterface.addIndex("catchBot", ["token_amount"]);
    await queryInterface.addIndex("catchBot", ["pnl_pct"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("catchBot");
  },
};
