import { DataSource } from "typeorm";
import { config } from "./index";
import { AccountEntity } from "../adapter/out/persistence/AccountEntity";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: true,
  logging: false,
  entities: [AccountEntity],
});
