import mysql2 from "mysql2/promise";
import { ClientsRepository } from "./clientsRepository";
import { APIRepository } from "./apiRepository";
import { ClientLogsRepository } from "./clientLogsRepository";

class Repositories {
  public clientsRepository: ClientsRepository;
  public apiRepository: APIRepository;
  public clientLogsRepository: ClientLogsRepository;

  constructor(pool: mysql2.Pool, apiBaseUrl: string) {
    this.clientsRepository = new ClientsRepository(pool);
    this.apiRepository = new APIRepository(apiBaseUrl);
    this.clientLogsRepository = new ClientLogsRepository(pool);
  }
}

export { Repositories };
