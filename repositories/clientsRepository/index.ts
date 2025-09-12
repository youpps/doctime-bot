import mysql2 from "mysql2/promise";
import { IClient } from "../../types/client";
import { createQuery, getAllQuery, updateQuery } from "./queries";

class ClientsRepository {
  constructor(private readonly pool: mysql2.Pool) {}

  async getOne(client: Partial<IClient>): Promise<IClient | null> {
    const users = await this.getAll(client);

    return users[0] ?? null;
  }

  async getAll(client: Partial<IClient>): Promise<IClient[]> {
    const [data]: any = await this.pool.query(getAllQuery(client), client);

    return data;
  }

  async create(client: Omit<IClient, "createdAt">) {
    await this.pool.query(createQuery(), client);
  }

  async update(client: Partial<IClient> & { telegramId: number }) {
    const [data]: any = await this.pool.query(updateQuery(client), client);

    return data;
  }
}

export { ClientsRepository };
