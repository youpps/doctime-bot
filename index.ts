import { Telegraf, Markup, Context } from "telegraf";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { Repositories } from "./repositories";
import createDatabase from "./database";

config();

interface UserState {
  diagnosis?: string;
  sections?: string[];
  messageIds?: number[];
  callbackMap?: { [key: string]: string };
  currentSection?: string;
}

interface BotContext extends Context {
  userState?: UserState;
}

interface SessionData {
  [userId: number]: UserState;
}

class SessionManager {
  private sessionFile: string;
  private sessionData: SessionData = {};

  constructor(sessionFileName: string = "session.json") {
    this.sessionFile = path.join(__dirname, sessionFileName);
    this.loadSessions();
  }

  private loadSessions(): void {
    try {
      if (!fs.existsSync(this.sessionFile)) return;

      const data = fs.readFileSync(this.sessionFile, "utf8");
      const parsedData = JSON.parse(data);

      this.sessionData = Object.fromEntries(
        Object.entries(parsedData).map(([userId, state]: [string, any]) => {
          if (state.callbackMap && Array.isArray(state.callbackMap)) {
            state.callbackMap = new Map(state.callbackMap);
          }
          return [userId, state];
        })
      );

      console.log(`Сессии загружены из ${this.sessionFile}`);
    } catch (error) {
      console.error("Ошибка при загрузке сессий:", error);
      this.sessionData = {};
    }
  }

  private saveSessions(): void {
    try {
      const serializableData = Object.fromEntries(
        Object.entries(this.sessionData).map(([userId, state]) => {
          const serializableState = { ...state };
          if (state.callbackMap instanceof Map) {
            serializableState.callbackMap = Array.from(state.callbackMap.entries());
          }
          return [userId, serializableState];
        })
      );

      fs.writeFileSync(this.sessionFile, JSON.stringify(serializableData, null, 2));
    } catch (error) {
      console.error("Ошибка при сохранении сессий:", error);
    }
  }

  getUserState(userId: number): UserState | undefined {
    return this.sessionData[userId];
  }

  setUserState(userId: number, state: UserState): void {
    this.sessionData[userId] = state;
    this.saveSessions();
  }

  updateUserState(userId: number, update: Partial<UserState>): void {
    if (!this.sessionData[userId]) {
      this.sessionData[userId] = {};
    }

    this.sessionData[userId] = { ...this.sessionData[userId], ...update };
    this.saveSessions();
  }

  deleteUserState(userId: number): void {
    if (this.sessionData[userId]) {
      delete this.sessionData[userId];
      this.saveSessions();
    }
  }

  clearAllSessions(): void {
    this.sessionData = {};
    this.saveSessions();
  }
}

class MedicalBot {
  private bot: Telegraf<BotContext>;
  private sessionManager: SessionManager;
  private repositories: Repositories;

  constructor(
    token: string,
    apiBaseURL: string,
    dbHost: string,
    dbPort: number,
    dbPassword: string,
    dbDatabase: string,
    dbUser: string
  ) {
    this.bot = new Telegraf<BotContext>(token);
    this.sessionManager = new SessionManager();

    const database = createDatabase({
      host: dbHost,
      port: dbPort,
      password: dbPassword,
      database: dbDatabase,
      user: dbUser,
    });

    this.repositories = new Repositories(database, apiBaseURL);

    this.setupMiddlewares();
    this.setupHandlers();
  }

  private setupMiddlewares(): void {
    this.bot.use(async (ctx, next) => {
      const user = ctx.from;
      if (!user) return next();

      await this.syncUserData(user);

      const userState = this.sessionManager.getUserState(user.id) || {
        messageIds: [],
        callbackMap: {},
      };

      ctx.userState = userState;
      return next();
    });
  }

  private async syncUserData(user: any): Promise<void> {
    try {
      const client = await this.repositories.clientsRepository.getOne({
        telegramId: user.id,
      });

      const userData = {
        telegramId: user.id,
        username: user.username ?? user.id.toString(),
        firstName: user.first_name,
        lastName: user.last_name ?? null,
      };

      if (!client) {
        await this.repositories.clientsRepository.create(userData);
      } else {
        await this.repositories.clientsRepository.update(userData);
      }
    } catch (error) {
      console.error("Ошибка синхронизации пользователя:", error);
    }
  }

  private setupHandlers(): void {
    this.bot.start((ctx) => this.handleStart(ctx));
    this.bot.command("new_diagnosis", (ctx) => this.handleNewDiagnosisCommand(ctx));
    this.bot.on("text", (ctx) => this.handleTextInput(ctx));

    this.bot.action(/select_diagnosis:(.+)/, (ctx) => this.handleDiagnosisSelection(ctx));
    this.bot.action(/select_section:(.+)/, (ctx) => this.handleSectionSelection(ctx));
    this.bot.action("new_diagnosis", (ctx) => this.handleNewDiagnosisAction(ctx));
    this.bot.action("back_to_sections", (ctx) => this.handleBackToSections(ctx));

    this.bot.on("message", (ctx) => this.handleOtherMessages(ctx));
  }

  private async handleStart(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);
    await this.sendWelcomeMessage(ctx);
  }

  private async handleNewDiagnosisCommand(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);
    await this.askForNewDiagnosis(ctx);
  }

  private async handleTextInput(ctx: BotContext): Promise<void> {
    const userInput = (ctx.message as any)?.text.trim();
    const userId = ctx.from?.id;

    if (userInput.startsWith("/") || !userId) return;

    await this.clearPreviousMessages(ctx);
    await this.handleDiagnosisInput(ctx, userInput);
  }

  private async handleDiagnosisSelection(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);

    const hash = ((ctx as any).match as RegExpMatchArray)[1];
    const diagnosis = await this.resolveCallbackMapping(ctx, `diagnosis:${hash}`);

    if (!diagnosis) {
      await this.sendErrorMessage(ctx, "Диагноз не найден");
      return;
    }

    await this.processDiagnosisSelection(ctx, diagnosis);
  }

  private async handleSectionSelection(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);

    const hash = ((ctx as any).match as RegExpMatchArray)[1];
    const sectionTitle = await this.resolveCallbackMapping(ctx, `section:${hash}`);

    if (!sectionTitle) {
      await this.sendErrorMessage(ctx, "Раздел не найден");
      return;
    }

    await this.processSectionSelection(ctx, sectionTitle);
  }

  private async handleNewDiagnosisAction(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);
    await this.askForNewDiagnosis(ctx);
  }

  private async handleBackToSections(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);
    await this.showSections(ctx);
  }

  private async handleOtherMessages(ctx: BotContext): Promise<void> {
    await this.clearPreviousMessages(ctx);
    await ctx.replyWithMarkdown("Пожалуйста, используйте текстовые сообщения для ввода диагноза или команды меню.");
  }

  private generateHash(text: string): string {
    return createHash("sha256").update(text).digest("hex").substring(0, 32);
  }

  private async storeCallbackMapping(
    ctx: BotContext,
    originalValue: string,
    type: "diagnosis" | "section"
  ): Promise<string> {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState) return "";

    const hash = this.generateHash(originalValue);
    const key = `${type}:${hash}`;

    ctx.userState.callbackMap = ctx.userState.callbackMap || {};
    ctx.userState.callbackMap[key] = originalValue;

    this.sessionManager.updateUserState(userId, { callbackMap: ctx.userState.callbackMap });

    return hash;
  }

  private async resolveCallbackMapping(ctx: BotContext, callbackData: string): Promise<string | null> {
    const userId = ctx.from?.id;
    return (userId && ctx.userState?.callbackMap?.[callbackData]) || null;
  }

  private async clearPreviousMessages(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState?.messageIds?.length) return;

    try {
      for (const messageId of ctx.userState.messageIds) {
        try {
          await ctx.deleteMessage(messageId);
        } catch (error) {
          console.log(`Не удалось удалить сообщение ${messageId}:`, error);
        }
      }

      this.sessionManager.updateUserState(userId, {
        messageIds: [],
        callbackMap: ctx.userState.callbackMap,
      });

      if (ctx.userState) {
        ctx.userState.messageIds = [];
      }
    } catch (error) {
      console.error("Ошибка при удалении сообщений:", error);
    }
  }

  private saveMessageId(ctx: BotContext, messageId: number): void {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState) return;

    const messageIds = ctx.userState.messageIds || [];
    messageIds.push(messageId);

    this.sessionManager.updateUserState(userId, { messageIds });
    ctx.userState.messageIds = messageIds;
  }

  private async sendWelcomeMessage(ctx: BotContext): Promise<void> {
    const welcomeText = `👋 Здравствуйте, доктор!
Я — DocTime.MedX, ваша медицинская база знаний.
Задайте вопрос — и я помогу найти актуальные клинические рекомендации, проверить протокол или подсказать по диагностике и лечению.

🩺 Давайте начнём: какой запрос хотите разобрать?`;

    const message = await ctx.replyWithMarkdown(
      welcomeText,
      Markup.inlineKeyboard([Markup.button.callback("Ввести диагноз", "new_diagnosis")])
    );

    this.saveMessageId(ctx, message.message_id);
  }

  private async askForNewDiagnosis(ctx: BotContext): Promise<void> {
    const message = await ctx.replyWithMarkdown("Введите название диагноза, который вас интересует:");
    this.saveMessageId(ctx, message.message_id);
  }

  private async handleDiagnosisInput(ctx: BotContext, userInput: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const searchingMessage = await ctx.replyWithMarkdown("Ищу похожие диагнозы...");
      this.saveMessageId(ctx, searchingMessage.message_id);

      const similarDiagnoses = await this.repositories.apiRepository.getSimilarDiagnoses(userInput);

      if (similarDiagnoses.length === 0) {
        await this.showNoResultsFound(ctx);
        return;
      }

      await this.showDiagnosisOptions(ctx, similarDiagnoses);
    } catch (error) {
      console.error("Error getting similar diagnoses:", error);
      await this.sendSearchError(ctx);
    }
  }

  private async showNoResultsFound(ctx: BotContext): Promise<void> {
    const message = await ctx.replyWithMarkdown(
      "По вашему запросу ничего не найдено. Попробуйте ввести другой диагноз или уточнить формулировку.",
      Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
    );
    this.saveMessageId(ctx, message.message_id);
  }

  private async showDiagnosisOptions(ctx: BotContext, diagnoses: string[]): Promise<void> {
    const correctDiagnoses = diagnoses.filter(
      (diagnosis) => diagnosis.lastIndexOf(diagnosis) === diagnoses.indexOf(diagnosis)
    );

    const buttons = await Promise.all(
      correctDiagnoses.map(async (diagnosis) => {
        const hash = await this.storeCallbackMapping(ctx, diagnosis, "diagnosis");
        return [Markup.button.callback(diagnosis, `select_diagnosis:${hash}`)];
      })
    );

    const keyboard = [...buttons, [Markup.button.callback("Ввести новый диагноз", "new_diagnosis")]];

    const message = await ctx.replyWithMarkdown(
      "Найдены следующие диагнозы. Выберите подходящий:",
      Markup.inlineKeyboard(keyboard)
    );

    this.saveMessageId(ctx, message.message_id);
  }

  private async processDiagnosisSelection(ctx: BotContext, diagnosis: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    this.sessionManager.updateUserState(userId, { diagnosis });
    if (ctx.userState) ctx.userState.diagnosis = diagnosis;

    const loadingMessage = await ctx.replyWithMarkdown(`*${diagnosis}*\n\nЗагружаю информацию...`);
    this.saveMessageId(ctx, loadingMessage.message_id);

    await this.showSections(ctx);
  }

  private async showSections(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const userState = this.sessionManager.getUserState(userId);
      if (!userState?.diagnosis) {
        await this.sendErrorMessage(ctx, "Информация не найдена");
        return;
      }

      const sections = await this.repositories.apiRepository.getSections(userState.diagnosis);

      if (sections.length === 0) {
        await this.showNoSectionsAvailable(ctx);
        return;
      }

      this.sessionManager.updateUserState(userId, { sections });
      if (ctx.userState) {
        ctx.userState.sections = sections;
      }

      await this.displaySectionsList(ctx, userState.diagnosis, sections);
    } catch (error) {
      console.error("Error getting sections:", error);
      await this.sendLoadError(ctx);
    }
  }

  private async showNoSectionsAvailable(ctx: BotContext): Promise<void> {
    const message = await ctx.replyWithMarkdown(
      "Для выбранного диагноза нет доступной информации.",
      Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
    );
    this.saveMessageId(ctx, message.message_id);
  }

  private async displaySectionsList(ctx: BotContext, diagnosis: string, sections: string[]): Promise<void> {
    const correctSections = sections
      .filter((section) => section !== "МКБ")
      .sort((a, b) => {
        const priorityA = a === "Лечение" || a === "Диагностика" ? 0 : 1;
        const priorityB = b === "Лечение" || b === "Диагностика" ? 0 : 1;

        return priorityA - priorityB;
      });

    const sectionButtons = await Promise.all(
      correctSections.map(async (section) => {
        const hash = await this.storeCallbackMapping(ctx, section, "section");
        return Markup.button.callback(section, `select_section:${hash}`);
      })
    );

    const keyboard = [];
    for (let i = 0; i < sectionButtons.length; i += 2) {
      keyboard.push(sectionButtons.slice(i, i + 2));
    }

    keyboard.push([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")]);

    const message = await ctx.replyWithMarkdown(
      `*${diagnosis}*\n\nДоступные разделы:`,
      Markup.inlineKeyboard(keyboard)
    );

    this.saveMessageId(ctx, message.message_id);
  }

  private async processSectionSelection(ctx: BotContext, sectionTitle: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const userState = this.sessionManager.getUserState(userId);
    if (!userState?.diagnosis) {
      await this.sendErrorMessage(ctx, "Информация не найдена");
      return;
    }

    this.sessionManager.updateUserState(userId, { currentSection: sectionTitle });

    const loadingMessage = await ctx.replyWithMarkdown(`*${sectionTitle}*\n\nЗагружаю содержимое...`);
    this.saveMessageId(ctx, loadingMessage.message_id);

    try {
      const content = await this.repositories.apiRepository.getSection(userState.diagnosis, sectionTitle);

      const correctContent = content.replace(/###\s/g, "").replace(/###/g, "");

      const message = await ctx.replyWithMarkdown(
        `*${sectionTitle}*\n\n${correctContent}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Назад к разделам", "back_to_sections")],
          [Markup.button.callback("Ввести новый диагноз", "new_diagnosis")],
        ])
      );

      this.saveMessageId(ctx, message.message_id);
    } catch (error) {
      console.error("Error loading section content:", error);
      await this.sendLoadError(ctx);
    }
  }

  private async sendErrorMessage(ctx: BotContext, message: string): Promise<void> {
    const errorMessage = await ctx.replyWithMarkdown(
      `${message}. Пожалуйста, попробуйте снова.`,
      Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
    );
    this.saveMessageId(ctx, errorMessage.message_id);
  }

  private async sendSearchError(ctx: BotContext): Promise<void> {
    const message = await ctx.replyWithMarkdown(
      "Произошла ошибка при поиске диагнозов. Попробуйте позже.",
      Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
    );
    this.saveMessageId(ctx, message.message_id);
  }

  private async sendLoadError(ctx: BotContext): Promise<void> {
    const message = await ctx.replyWithMarkdown(
      "Произошла ошибка при загрузке информации. Попробуйте позже.",
      Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
    );
    this.saveMessageId(ctx, message.message_id);
  }

  public launch(): void {
    this.bot.launch(() => {
      console.log("Бот запущен");
    });

    process.once("SIGINT", () => this.gracefulShutdown("SIGINT"));
    process.once("SIGTERM", () => this.gracefulShutdown("SIGTERM"));
  }

  private gracefulShutdown(signal: string): void {
    console.log("Сохранение сессий перед завершением...");
    this.bot.stop(signal);
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost";

const DB_HOST = process.env.DB_HOST || "";
const DB_PORT = Number(process.env.DB_PORT || "");
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_DATABASE = process.env.DB_DATABASE || "";
const DB_USER = process.env.DB_USER || "";

if (!BOT_TOKEN) {
  console.error("Please set BOT_TOKEN environment variable");
  process.exit(1);
}

if (!API_BASE_URL) {
  console.error("Please set API_BASE_URL environment variable");
  process.exit(1);
}

const medicalBot = new MedicalBot(BOT_TOKEN, API_BASE_URL, DB_HOST, DB_PORT, DB_PASSWORD, DB_DATABASE, DB_USER);

medicalBot.launch();
