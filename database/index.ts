import mysql from "mysql2/promise";

type DatabaseOptions = {
  host: string;
  port: string | number;
  user: string;
  password: string;
  database: string;
};

function createDatabase(options: DatabaseOptions) {
  const pool = mysql.createPool({
    host: options.host,
    port: Number(options.port),
    user: options.user,
    password: options.password,
    database: options.database,
    connectionLimit: 50,
    waitForConnections: true,
    namedPlaceholders: true,
  });

  pool.on("connection", (connection) => {
    connection.on("error", (e) => {
      console.log(e);
      console.log("DISCONNECT");
    });

    connection.on("close", () => {
      console.error("CLOSE");
    });
  });

  return pool;
}

export default createDatabase;
