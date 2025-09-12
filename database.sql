CREATE TABLE doctimeai

CREATE TABLE clients (
    telegramId BIGINT NOT NULL PRIMARY KEY,
    username VARCHAR(256) NOT NULL,
    firstName VARCHAR(256) NOT NULL,
    lastName VARCHAR(256),
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE client_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    text VARCHAR(2048) NOT NULL,

    client_telegram_id BIGINT NOT NULL,

    FOREIGN KEY(client_telegram_id) REFERENCES clients(telegramId) 
);