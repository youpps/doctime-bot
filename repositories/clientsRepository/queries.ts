import { IClient } from "../../types/client";

const createQuery = () =>
  `INSERT INTO bot_users(telegramId, username, firstName, lastName) VALUES(:telegramId, :username, :firstName, :lastName)`;

const getAllQuery = (client: Partial<IClient>) => {
  const keys = Object.keys(client);
  const where = keys.length ? `WHERE ` + keys.map((key) => `${key} = :${key}`).join(" AND ") : "";

  return `SELECT telegramId, username, firstName, lastName, createdAt FROM bot_users ${where};`;
};

const updateQuery = (client: Partial<IClient> & { telegramId: number }) => {
  const keys = Object.keys(client);
  const sets = keys.length ? keys.map((key) => `${key} = :${key}`).join(", ") : "";

  return `UPDATE bot_users SET ${sets} WHERE telegramId = :telegramId;`;
};

export { createQuery, getAllQuery ,updateQuery};
