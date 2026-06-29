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
      buy_or_sell_time: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      token_amount: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },

      pnl_pct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
    },
    {
      tableName: "catchBot",
      underscored: true,
      timestamps: false,
    },
  );
};
