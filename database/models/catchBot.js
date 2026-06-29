export const CatchBot = (sequelize, DataTypes) => {
  return sequelize.define(
    "catchBot",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      mint: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      buyOrSellTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      tokenAmount: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },

      pnlPct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
    },
    {
      tableName: "catched_points",
      underscored: true,
      timestamps: false,
    },
  );
};
