import mysql2 from "mysql2/promise";
import { IClient } from "../../types/client";
import { createQuery } from "./queries";
import { IClientLog } from "../../types/clientLog";

class ClientLogsRepository {
  constructor(private readonly pool: mysql2.Pool) {}

  async create(clientLog: Omit<IClientLog, "id" | "createdAt">) {
    await this.pool.query(createQuery(), clientLog);
  }
}

export { ClientLogsRepository };
