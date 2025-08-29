import { Telegraf, Markup, Context } from "telegraf";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

config();

interface UserState {
  currentDiagnosis?: string;
  sections?: string[];
  messageIds?: number[];
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
      if (fs.existsSync(this.sessionFile)) {
        const data = fs.readFileSync(this.sessionFile, "utf8");
        this.sessionData = JSON.parse(data);
        console.log(`Сессии загружены из ${this.sessionFile}`);
      }
    } catch (error) {
      console.error("Ошибка при загрузке сессий:", error);
      this.sessionData = {};
    }
  }

  private saveSessions(): void {
    try {
      fs.writeFileSync(this.sessionFile, JSON.stringify(this.sessionData, null, 2));
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

class HttpClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(endpoint, this.baseURL);

    if (params) {
      Object.keys(params).forEach((key) => {
        url.searchParams.append(key, params[key]);
      });
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}

class MedicalBot {
  private bot: Telegraf<BotContext>;
  private sessionManager: SessionManager;
  private httpClient: HttpClient;

  constructor(token: string, apiBaseURL: string) {
    this.bot = new Telegraf<BotContext>(token);
    this.sessionManager = new SessionManager();
    this.httpClient = new HttpClient(apiBaseURL);

    this.setupMiddlewares();
    this.setupHandlers();
  }

  private setupMiddlewares() {
    this.bot.use((ctx, next) => {
      const userId = ctx.from?.id ?? 0;

      if (userId) {
        const userState = this.sessionManager.getUserState(userId) || { messageIds: [] };
        ctx.userState = userState;
      }

      return next();
    });
  }

  private setupHandlers() {
    this.bot.start(async (ctx) => {
      await this.clearPreviousMessages(ctx);
      await this.sendWelcomeMessage(ctx);
    });

    this.bot.command("new_diagnosis", async (ctx) => {
      await this.clearPreviousMessages(ctx);
      await this.askForNewDiagnosis(ctx);
    });

    this.bot.on("text", async (ctx) => {
      const userInput = ctx.message.text.trim();
      const userId = ctx.from?.id;

      if (userInput.startsWith("/")) {
        return;
      }

      if (!userId) return;

      await this.clearPreviousMessages(ctx);
      await this.handleDiagnosisInput(ctx, userInput);
    });

    this.bot.action(/select_diagnosis:(.+)/, async (ctx) => {
      await this.clearPreviousMessages(ctx);
      await this.handleDiagnosisSelection(ctx);
    });

    this.bot.action(/select_section:(.+)/, async (ctx) => {
      await this.clearPreviousMessages(ctx);
      await this.handleSectionSelection(ctx);
    });

    this.bot.action("new_diagnosis", async (ctx) => {
      await this.clearPreviousMessages(ctx);
      await this.askForNewDiagnosis(ctx);
    });

    this.bot.on("message", async (ctx) => {
      await this.clearPreviousMessages(ctx);
      await ctx.reply("Пожалуйста, используйте текстовые сообщения для ввода диагноза или команды меню.");
    });
  }

  private async clearPreviousMessages(ctx: BotContext) {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState || !ctx.userState.messageIds || ctx.userState.messageIds.length === 0) {
      return;
    }

    try {
      for (const messageId of ctx.userState.messageIds) {
        try {
          await ctx.deleteMessage(messageId);
        } catch (error) {
          console.log(`Не удалось удалить сообщение ${messageId}:`, error);
        }
      }

      // Обновляем состояние пользователя
      this.sessionManager.updateUserState(userId, { messageIds: [] });
      ctx.userState.messageIds = [];
    } catch (error) {
      console.error("Ошибка при удалении сообщений:", error);
    }
  }

  private saveMessageId(ctx: BotContext, messageId: number) {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState) return;

    const messageIds = ctx.userState.messageIds || [];
    messageIds.push(messageId);

    // Обновляем состояние в файле
    this.sessionManager.updateUserState(userId, { messageIds });
    ctx.userState.messageIds = messageIds;
  }

  private async sendWelcomeMessage(ctx: BotContext) {
    const userId = ctx.from?.id;
    if (!userId) return;

    const welcomeText = `👋 Здравствуйте, доктор!
Я — DocTime.MedX, ваша медицинская база знаний.
Задайте вопрос — и я помогу найти актуальные клинические рекомендации, проверить протокол или подсказать по диагностике и лечению.

🩺 Давайте начнём: какой запрос хотите разобрать?`;

    const message = await ctx.reply(
      welcomeText,
      Markup.inlineKeyboard([Markup.button.callback("Ввести диагноз", "new_diagnosis")])
    );

    this.saveMessageId(ctx, message.message_id);
  }

  private async askForNewDiagnosis(ctx: BotContext) {
    const userId = ctx.from?.id;
    if (!userId) return;

    const message = await ctx.reply("Введите название диагноза, который вас интересует:");
    this.saveMessageId(ctx, message.message_id);
  }

  private async handleDiagnosisInput(ctx: BotContext, userInput: string) {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const searchingMessage = await ctx.reply("Ищу похожие диагнозы...");
      this.saveMessageId(ctx, searchingMessage.message_id);

      const similarDiagnoses = await this.getSimilarDiagnoses(userInput);

      if (similarDiagnoses.length === 0) {
        const notFoundMessage = await ctx.reply(
          "По вашему запросу ничего не найдено. Попробуйте ввести другой диагноз или уточнить формулировку.",
          Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
        );
        this.saveMessageId(ctx, notFoundMessage.message_id);
        return;
      }

      const buttons = similarDiagnoses.map((diagnosis) => [
        Markup.button.callback(diagnosis, `select_diagnosis:${diagnosis}`),
      ]);

      buttons.push([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")]);

      const diagnosisMessage = await ctx.reply(
        "Найдены следующие диагнозы. Выберите подходящий:",
        Markup.inlineKeyboard(buttons)
      );
      this.saveMessageId(ctx, diagnosisMessage.message_id);
    } catch (error) {
      console.error("Error getting similar diagnoses:", error);
      const errorMessage = await ctx.reply(
        "Произошла ошибка при поиске диагнозов. Попробуйте позже.",
        Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
      );
      this.saveMessageId(ctx, errorMessage.message_id);
    }
  }

  private async handleDiagnosisSelection(ctx: BotContext) {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      await ctx.answerCbQuery();

      const diagnosis = ((ctx as any).match as RegExpMatchArray)[1];

      this.sessionManager.updateUserState(userId, { currentDiagnosis: diagnosis });
      if (ctx.userState) {
        ctx.userState.currentDiagnosis = diagnosis;
      }

      const loadingMessage = await ctx.reply(`Выбран диагноз: ${diagnosis}\n\nЗагружаю информацию...`);
      this.saveMessageId(ctx, loadingMessage.message_id);

      const sections = await this.getSections(diagnosis);

      if (sections.length === 0) {
        const noInfoMessage = await ctx.reply(
          "Для выбранного диагноза нет доступной информации.",
          Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
        );
        this.saveMessageId(ctx, noInfoMessage.message_id);
        return;
      }

      // Сохраняем секции в сессии
      this.sessionManager.updateUserState(userId, { sections });
      if (ctx.userState) {
        ctx.userState.sections = sections;
      }

      const buttons = sections.map((section) => [Markup.button.callback(section, `select_section:${section}`)]);

      buttons.push([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")]);

      const sectionsMessage = await ctx.reply("Доступные разделы:", Markup.inlineKeyboard(buttons));
      this.saveMessageId(ctx, sectionsMessage.message_id);
    } catch (error) {
      console.error("Error getting diagnosis sections:", error);

      const errorMessage = await ctx.reply(
        "Произошла ошибка при загрузке информации. Попробуйте позже.",
        Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
      );

      this.saveMessageId(ctx, errorMessage.message_id);
    }
  }

  private async handleSectionSelection(ctx: BotContext) {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      await ctx.answerCbQuery();

      const sectionTitle = ((ctx as any).match as RegExpMatchArray)[1];

      // Загружаем актуальное состояние из файла
      const userState = this.sessionManager.getUserState(userId);
      if (!userState || !userState.sections) {
        const errorMessage = await ctx.reply(
          "Информация не найдена. Пожалуйста, начните сначала.",
          Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
        );
        this.saveMessageId(ctx, errorMessage.message_id);
        return;
      }

      const section = userState.sections.find((s) => s === sectionTitle);

      if (!section) {
        const notFoundMessage = await ctx.reply(
          "Раздел не найден.",
          Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
        );
        this.saveMessageId(ctx, notFoundMessage.message_id);
        return;
      }

      const content = await this.getSection(section);

      const sectionMessage = await ctx.reply(
        `**${section}**\n\n${content}`,
        Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
      );

      this.saveMessageId(ctx, sectionMessage.message_id);
    } catch (error) {
      console.error("Error handling section selection:", error);

      const errorMessage = await ctx.reply(
        "Произошла ошибка при загрузке раздела. Попробуйте позже.",
        Markup.inlineKeyboard([Markup.button.callback("Ввести новый диагноз", "new_diagnosis")])
      );

      this.saveMessageId(ctx, errorMessage.message_id);
    }
  }

  private async getSimilarDiagnoses(diagnosis: string): Promise<string[]> {
    try {
      //   const response = await this.httpClient.get<SimilarDiagnosesResponse>("/diagnoses/similar", { diagnosis });

      return ["Диагноз 1", "Диагноз 2"];

      //   return response.diagnoses;
    } catch (error) {
      console.error("API Error - getSimilarDiagnoses:", error);
      throw new Error("Failed to get similar diagnoses");
    }
  }

  private async getSections(diagnosis: string): Promise<string[]> {
    try {
      //   const response = await this.httpClient.get<DiagnosisSectionsResponse>("/sections", { diagnosis });

      // Mock
      return ["Название секции 1", "Название секции 2", "Название секции 3"];
      //   return response.sections;
    } catch (error) {
      console.error("API Error - getDiagnosisSections:", error);
      throw new Error("Failed to get diagnosis sections");
    }
  }

  private async getSection(sectionName: string) {
    try {
      //   const response = await this.httpClient.get<DiagnosisSectionsResponse>(`/sections/${sectionName}`, { diagnosis });

      // Mock
      return "test";
      //   return response.sections;
    } catch (error) {
      console.error("API Error - getDiagnosisSections:", error);
      throw new Error("Failed to get diagnosis sections");
    }
  }

  public launch() {
    this.bot.launch(() => {
      console.log("Бот запущен");
    });

    // Graceful shutdown
    process.once("SIGINT", () => {
      console.log("Сохранение сессий перед завершением...");
      this.bot.stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      console.log("Сохранение сессий перед завершением...");
      this.bot.stop("SIGTERM");
    });
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost";

if (!BOT_TOKEN) {
  console.error("Please set BOT_TOKEN environment variable");
  process.exit(1);
}

if (!API_BASE_URL) {
  console.error("Please set API_BASE_URL environment variable");
  process.exit(1);
}

const medicalBot = new MedicalBot(BOT_TOKEN, API_BASE_URL);
medicalBot.launch();
