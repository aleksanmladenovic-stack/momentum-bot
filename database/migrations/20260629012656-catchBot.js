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
      buyOrSellTime: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      tokenAmount: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      solAmount: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      pnlPct: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
    });

    await queryInterface.addIndex("catchBot", ["mint"]);
    await queryInterface.addIndex("catchBot", ["buyOrSellTime"]);
    await queryInterface.addIndex("catchBot", ["tokenAmount"]);
    await queryInterface.addIndex("catchBot", ["solAmount"]);
    await queryInterface.addIndex("catchBot", ["pnlPct"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("catchBot");
  },
};
