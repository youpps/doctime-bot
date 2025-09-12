import mysql2 from "mysql2/promise";
import { ClientsRepository } from "./clientsRepository";
import { APIRepository } from "./apiRepository";

class Repositories {
  public clientsRepository: ClientsRepository;
  public apiRepository: APIRepository

  constructor(pool: mysql2.Pool, apiBaseUrl: string) {
    this.clientsRepository = new ClientsRepository(pool);
    this.apiRepository = new APIRepository(apiBaseUrl)
  }
}

export { Repositories };
