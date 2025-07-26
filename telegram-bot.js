const TelegramBot = require('node-telegram-bot-api');
const BotManager = require('./bot-manager');
const Database = require('./database');

class MinecraftTelegramBot {
    constructor(token) {
        this.bot = new TelegramBot(token, {
            polling: {
                interval: 1000,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        this.botManager = null;
        this.db = null;
        this.userStates = new Map(); // لحفظ حالة المحادثة مع كل مستخدم
        this.adminIds = []; // قائمة معرفات الأدمن
        this.initialized = false;
        this.welcomeMessages = new Map(); // لحفظ معرفات رسائل الترحيب
        this.warningMessages = new Map(); // لحفظ معرفات رسائل التحذير
        this.finalNotificationMessages = new Map(); // لحفظ معرفات رسائل الإيقاف النهائي
        this.loadingMessages = new Map(); // لحفظ معرفات رسائل "جاري التشغيل"
        this.lastActionMessages = new Map(); // لحفظ معرف آخر رسالة إجراء

        // معالجة أخطاء التلغرام (مع تجنب الرسائل المتكررة)
        this.lastTelegramError = null;
        this.lastTelegramErrorTime = 0;

        this.bot.on('polling_error', (error) => {
            const now = Date.now();
            // تجنب طباعة نفس الخطأ أكثر من مرة كل 30 ثانية
            if (this.lastTelegramError !== error.code || now - this.lastTelegramErrorTime > 30000) {
                console.log(`⚠️ خطأ في التلغرام: ${error.code}`);
                this.lastTelegramError = error.code;
                this.lastTelegramErrorTime = now;

                if (error.code === 'EFATAL') {
                    console.log('🔄 محاولة إعادة الاتصال بالتلغرام...');
                    setTimeout(() => {
                        this.bot.startPolling();
                    }, 5000);
                }
            }
        });

        this.init().then(() => {
            this.setupCommands();
            this.setupCallbacks();
            this.setupBotManagerEvents();
            this.setupBotCommands();
            console.log('🤖 تم تشغيل بوت التلغرام بنجاح');
        }).catch(error => {
            console.error('❌ خطأ في تهيئة البوت:', error.message);
        });
    }

    async init() {
        if (!this.initialized) {
            this.botManager = await new BotManager().init();
            this.db = await new Database().init();
            this.initialized = true;
        }
        return this;
    }

    async setupBotCommands() {
        try {
            const commands = [
                { command: 'start', description: '🚀 بدء استخدام البوت' },
                { command: 'newbot', description: '🆕 إنشاء بوت جديد' },
                { command: 'mybots', description: '🤖 عرض وإدارة بوتاتي' },
                { command: 'stats', description: '📊 عرض الإحصائيات' },
                { command: 'help', description: '❓ المساعدة والدعم' },
                { command: 'clearmybots', description: '🗑️ مسح جميع بوتاتي' }
            ];

            await this.bot.setMyCommands(commands);
            console.log('✅ تم تعيين قائمة الأوامر في شريط الكتابة');
        } catch (error) {
            console.error('خطأ في تعيين قائمة الأوامر:', error);
        }
    }

    // تنظيف المحادثة (الحفاظ على رسالة الترحيب + آخر رسالة إجراء)
    async cleanChat(chatId) {
        try {
            // الحصول على معرف رسالة الترحيب المحمية
            const welcomeMessageId = this.welcomeMessages.get(chatId);
            const lastActionMessageId = this.lastActionMessages.get(chatId);

            console.log(`🧹 تنظيف المحادثة ${chatId} (الحفاظ على رسالتين فقط)`);

            let deletedCount = 0;

            // إنشاء قائمة بمعرفات الرسائل المحتملة (أقل عدد لتحسين الأداء)
            const messagesToTry = [];
            const currentTime = Math.floor(Date.now() / 1000);
            for (let i = 1; i <= 50; i++) {
                messagesToTry.push(currentTime - i);
                messagesToTry.push(currentTime + i);
            }

            // محاولة حذف الرسائل
            for (const messageId of messagesToTry) {
                try {
                    // تجنب حذف رسالة الترحيب المحمية
                    if (welcomeMessageId && messageId === welcomeMessageId) {
                        continue;
                    }

                    // تجنب حذف آخر رسالة إجراء
                    if (lastActionMessageId && messageId === lastActionMessageId) {
                        continue;
                    }

                    await this.bot.deleteMessage(chatId, messageId);
                    deletedCount++;

                    // توقف قصير لتجنب حدود التلغرام
                    if (deletedCount % 5 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (deleteError) {
                    // تجاهل أخطاء الحذف (رسائل غير موجودة)
                }
            }

            console.log(`🧹 تم حذف ${deletedCount} رسالة من المحادثة ${chatId}`);
            console.log(`✅ المحادثة نظيفة - رسالتان فقط: الترحيب + آخر إجراء`);
        } catch (error) {
            console.log('تم تنظيف المحادثة');
        }
    }





    // حذف رسائل التحذير المحفوظة
    async deleteWarningMessages(chatId, botId) {
        try {
            const warningMessageIds = this.warningMessages.get(botId);
            if (warningMessageIds && warningMessageIds.length > 0) {
                console.log(`🗑️ حذف ${warningMessageIds.length} رسالة تحذير للبوت ${botId}`);

                for (const messageId of warningMessageIds) {
                    try {
                        await this.bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        // تجاهل أخطاء الحذف (رسائل قد تكون محذوفة بالفعل)
                    }
                }

                // مسح قائمة رسائل التحذير
                this.warningMessages.delete(botId);
                console.log(`✅ تم حذف جميع رسائل التحذير للبوت ${botId}`);
            }
        } catch (error) {
            console.error('خطأ في حذف رسائل التحذير:', error);
        }
    }

    // حذف رسالة الإشعار النهائي
    async deleteFinalNotification(chatId, botId) {
        try {
            const finalMessageId = this.finalNotificationMessages.get(botId);
            if (finalMessageId) {
                console.log(`🗑️ حذف رسالة الإيقاف النهائي للبوت ${botId}`);

                try {
                    await this.bot.deleteMessage(chatId, finalMessageId);
                    console.log(`✅ تم حذف رسالة الإيقاف النهائي للبوت ${botId}`);
                } catch (deleteError) {
                    // تجاهل أخطاء الحذف (رسالة قد تكون محذوفة بالفعل)
                }

                // مسح معرف الرسالة
                this.finalNotificationMessages.delete(botId);
            }
        } catch (error) {
            console.error('خطأ في حذف رسالة الإيقاف النهائي:', error);
        }
    }

    // حذف جميع رسائل الإيقاف النهائي
    async deleteAllFinalNotifications(chatId) {
        try {
            if (this.finalNotificationMessages.size > 0) {
                console.log(`🗑️ حذف جميع رسائل الإيقاف النهائي من المحادثة ${chatId}`);

                for (const [, messageId] of this.finalNotificationMessages) {
                    try {
                        await this.bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        // تجاهل أخطاء الحذف
                    }
                }

                // مسح جميع معرفات الرسائل
                this.finalNotificationMessages.clear();
                console.log(`✅ تم حذف جميع رسائل الإيقاف النهائي`);
            }
        } catch (error) {
            console.error('خطأ في حذف جميع رسائل الإيقاف النهائي:', error);
        }
    }

    // حذف رسالة "جاري التشغيل"
    async deleteLoadingMessage(chatId, botId) {
        try {
            const loadingMessageId = this.loadingMessages.get(botId);
            if (loadingMessageId) {
                console.log(`🗑️ حذف رسالة "جاري التشغيل" للبوت ${botId}`);

                try {
                    await this.bot.deleteMessage(chatId, loadingMessageId);
                    console.log(`✅ تم حذف رسالة "جاري التشغيل" للبوت ${botId}`);
                } catch (deleteError) {
                    // تجاهل أخطاء الحذف (رسالة قد تكون محذوفة بالفعل)
                }

                // مسح معرف الرسالة
                this.loadingMessages.delete(botId);
            }
        } catch (error) {
            console.error('خطأ في حذف رسالة "جاري التشغيل":', error);
        }
    }

    // حفظ آخر رسالة إجراء وحذف السابقة (مع حماية رسالة الترحيب)
    async setLastActionMessage(chatId, messageId) {
        try {
            // الحصول على معرف رسالة الترحيب المحمية
            const welcomeMessageId = this.welcomeMessages.get(chatId);

            // حذف آخر رسالة إجراء إذا كانت موجودة وليست رسالة الترحيب
            const lastMessageId = this.lastActionMessages.get(chatId);
            if (lastMessageId && lastMessageId !== welcomeMessageId) {
                try {
                    await this.bot.deleteMessage(chatId, lastMessageId);
                    console.log(`🗑️ تم حذف آخر رسالة إجراء: ${lastMessageId}`);
                } catch (deleteError) {
                    // تجاهل أخطاء الحذف
                }
            }

            // حفظ معرف الرسالة الجديدة
            this.lastActionMessages.set(chatId, messageId);
            console.log(`💾 تم حفظ آخر رسالة إجراء: ${messageId}`);

            // إذا كانت هذه رسالة الترحيب، لا نحذفها أبداً
            if (messageId === welcomeMessageId) {
                console.log(`🛡️ رسالة الترحيب محمية من الحذف: ${messageId}`);
            }
        } catch (error) {
            console.error('خطأ في حفظ آخر رسالة إجراء:', error);
        }
    }

    // التأكد من وجود رسالة الترحيب وإرسالها إذا لم تكن موجودة
    async ensureWelcomeMessage(chatId, userId = null) {
        try {
            const welcomeMessageId = this.welcomeMessages.get(chatId);

            // التحقق من وجود رسالة الترحيب
            if (!welcomeMessageId) {
                console.log(`🔍 لا توجد رسالة ترحيب للمحادثة ${chatId} - إرسال رسالة جديدة`);
                await this.sendWelcomeMessage(chatId, userId);
                return;
            }

            // التحقق من أن رسالة الترحيب لا تزال موجودة بمحاولة تحديثها
            try {
                // محاولة تحديث الرسالة للتأكد من وجودها
                await this.bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: welcomeMessageId }
                );
                // إذا نجحت، أعد الأزرار الأصلية
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '🆕 إنشاء بوت جديد', callback_data: 'new_bot' },
                            { text: '🤖 بوتاتي', callback_data: 'my_bots' }
                        ],
                        [
                            { text: '📊 الإحصائيات', callback_data: 'stats' },
                            { text: '❓ المساعدة', callback_data: 'help' }
                        ]
                    ]
                };
                await this.bot.editMessageReplyMarkup(
                    keyboard,
                    { chat_id: chatId, message_id: welcomeMessageId }
                );
                console.log(`✅ رسالة الترحيب موجودة للمحادثة ${chatId}`);
            } catch (error) {
                // إذا لم تعد الرسالة موجودة، أرسل رسالة جديدة
                console.log(`🔄 رسالة الترحيب محذوفة للمحادثة ${chatId} - إرسال رسالة جديدة`);
                this.welcomeMessages.delete(chatId); // إزالة المعرف القديم
                await this.sendWelcomeMessage(chatId, userId);
            }
        } catch (error) {
            console.error('خطأ في التأكد من رسالة الترحيب:', error);
            // في حالة أي خطأ، أرسل رسالة ترحيب جديدة
            await this.sendWelcomeMessage(chatId, userId);
        }
    }

    // إرسال رسالة الترحيب
    async sendWelcomeMessage(chatId, userId = null) {
        try {
            const welcomeMessage =
                `🎮 **مرحباً بك في بوت ماينكرافت!**\n\n` +
                `🤖 يمكنك إنشاء وإدارة بوتات ماينكرافت بسهولة\n` +
                `🌐 دعم Java و Bedrock\n` +
                `⚡ تحكم كامل في البوتات\n\n` +
                `📋 **اختر ما تريد فعله:**`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🆕 إنشاء بوت جديد', callback_data: 'new_bot' },
                        { text: '🤖 بوتاتي', callback_data: 'my_bots' }
                    ],
                    [
                        { text: '📊 الإحصائيات', callback_data: 'stats' },
                        { text: '❓ المساعدة', callback_data: 'help' }
                    ]
                ]
            };

            // إضافة أزرار الأدمن إذا كان المستخدم أدمن
            if (userId && this.adminIds.includes(userId)) {
                keyboard.inline_keyboard.push([
                    { text: '⚙️ إدارة النظام', callback_data: 'admin_panel' }
                ]);
            }

            const welcomeMsg = await this.bot.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

            // حفظ معرف رسالة الترحيب لحمايتها من الحذف
            this.welcomeMessages = this.welcomeMessages || new Map();
            this.welcomeMessages.set(chatId, welcomeMsg.message_id);

            // حفظ رسالة الترحيب كآخر رسالة إجراء
            await this.setLastActionMessage(chatId, welcomeMsg.message_id);

            console.log(`💾 تم إرسال وحفظ رسالة الترحيب الجديدة: ${welcomeMsg.message_id}`);
        } catch (error) {
            console.error('خطأ في إرسال رسالة الترحيب:', error);
        }
    }





    // تحديث قائمة البوتات مع الحالة الحقيقية
    async refreshMyBots(chatId, userId) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ يرجى البدء بالأمر /start أولاً');
                return;
            }

            const result = await this.botManager.getUserBots(user.id);
            if (!result.success) {
                await this.bot.sendMessage(chatId, `❌ ${result.error}`);
                return;
            }

            const bots = result.data;
            if (bots.length === 0) {
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '🚀 إنشاء بوت', callback_data: 'new_bot' }
                        ],
                        [
                            { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
                        ]
                    ]
                };

                await this.bot.sendMessage(chatId,
                    '🤖 **لا توجد بوتات**\n\n' +
                    'ابدأ بإنشاء بوت جديد!',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    }
                );
                return;
            }

            let message = '🤖 **بوتاتك:**\n\n';
            const keyboard = { inline_keyboard: [] };

            // فحص حالة كل بوت في الوقت الفعلي
            for (const bot of bots) {
                const botInfo = await this.botManager.getBotInfo(bot.id);
                const isConnected = botInfo.success && botInfo.data.connected;

                const statusEmoji = isConnected ? '🟢' : '🔴';
                const statusText = isConnected ? 'نشط' : 'متوقف';
                const editionEmoji = bot.edition === 'java' ? '☕' : '🪨';

                message += `┌─────────────────────────┐\n`;
                message += `│ ${statusEmoji} **${bot.name}** (${statusText})\n`;
                message += `│ 🌐 ${bot.host}:${bot.port}\n`;
                message += `│ ${editionEmoji} ${bot.edition === 'java' ? 'Java' : 'Bedrock'} ${bot.version}\n`;
                message += `└─────────────────────────┘\n\n`;

                // إضافة أزرار محدثة حسب الحالة الفعلية
                const botButtons = [
                    { text: `⚙️ ${bot.name}`, callback_data: `bot_manage_${bot.id}` }
                ];

                if (isConnected) {
                    botButtons.push({ text: `⏹️ إيقاف`, callback_data: `bot_action_${bot.id}_stop` });
                } else {
                    botButtons.push({ text: `▶️ تشغيل`, callback_data: `bot_action_${bot.id}_start` });
                }

                keyboard.inline_keyboard.push(botButtons);
            }

            // إضافة أزرار إضافية
            keyboard.inline_keyboard.push([
                { text: '🆕 إنشاء بوت', callback_data: 'new_bot' }
            ]);

            if (bots.length > 0) {
                keyboard.inline_keyboard.push([
                    { text: '🗑️ مسح الكل', callback_data: 'user_clear_all_bots' }
                ]);
            }

            keyboard.inline_keyboard.push([
                { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
            ]);

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('خطأ في refreshMyBots:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة مرة أخرى');
        }
    }

    setupCommands() {
        // الأوامر الأساسية مع حذف قائمة الإيقاف والتأكد من رسالة الترحيب
        this.bot.onText(/\/start/, async (msg) => {
            await this.deleteAllFinalNotifications(msg.chat.id);
            await this.handleStart(msg);
        });
        this.bot.onText(/\/help/, async (msg) => {
            await this.deleteAllFinalNotifications(msg.chat.id);
            await this.ensureWelcomeMessage(msg.chat.id);
            await this.handleHelp(msg);
        });
        this.bot.onText(/\/mybots/, async (msg) => {
            await this.deleteAllFinalNotifications(msg.chat.id);
            await this.ensureWelcomeMessage(msg.chat.id);
            await this.handleMyBots(msg);
        });
        this.bot.onText(/\/newbot/, async (msg) => {
            await this.deleteAllFinalNotifications(msg.chat.id);
            await this.ensureWelcomeMessage(msg.chat.id);
            await this.handleNewBot(msg);
        });
        this.bot.onText(/\/stats/, async (msg) => {
            await this.deleteAllFinalNotifications(msg.chat.id);
            await this.ensureWelcomeMessage(msg.chat.id);
            await this.handleStats(msg);
        });
        this.bot.onText(/\/clearmybots/, async (msg) => {
            await this.deleteAllFinalNotifications(msg.chat.id);
            await this.ensureWelcomeMessage(msg.chat.id);
            await this.handleClearMyBotsCommand(msg);
        });
        
        // أوامر الأدمن
        this.bot.onText(/\/admin/, (msg) => this.handleAdmin(msg));
        this.bot.onText(/\/allusers/, (msg) => this.handleAllUsers(msg));
        this.bot.onText(/\/allbots/, (msg) => this.handleAllBotsAdmin(msg));
        this.bot.onText(/\/broadcast (.+)/, (msg, match) => this.handleBroadcast(msg, match[1]));
        this.bot.onText(/\/clearallbots/, (msg) => this.handleClearAllBotsCommand(msg));
        
        // معالجة الرسائل النصية
        this.bot.on('message', (msg) => this.handleMessage(msg));
    }

    setupCallbacks() {
        this.bot.on('callback_query', async (callbackQuery) => {
            const action = callbackQuery.data;
            const msg = callbackQuery.message;
            const chatId = msg.chat.id;
            const userId = callbackQuery.from.id;
            const messageId = msg.message_id;

            try {
                // حذف أي إشعار نهائي موجود عند أي إجراء من المستخدم
                if (action.startsWith('bot_action_') || action.startsWith('bot_manage_')) {
                    const botId = parseInt(action.split('_')[2]);
                    if (botId) {
                        await this.deleteFinalNotification(chatId, botId);
                    }
                }

                // حذف قائمة الإيقاف عند أي إجراء آخر من المستخدم والتأكد من رسالة الترحيب
                if (action === 'my_bots' || action === 'main_menu' || action === 'new_bot' ||
                    action === 'help' || action === 'stats' || action.startsWith('admin_')) {
                    // حذف جميع رسائل الإيقاف النهائي
                    for (const [botId] of this.finalNotificationMessages) {
                        await this.deleteFinalNotification(chatId, botId);
                    }
                    // التأكد من وجود رسالة الترحيب
                    await this.ensureWelcomeMessage(chatId);
                }

                // التحقق من أن الرسالة ليست رسالة الترحيب المحفوظة
                const welcomeMessages = this.welcomeMessages || new Map();
                const isProtectedWelcomeMessage = welcomeMessages.get(chatId) === messageId;

                if (!isProtectedWelcomeMessage) {
                    try {
                        await this.bot.deleteMessage(chatId, messageId);
                    } catch (deleteError) {
                        // في حالة فشل الحذف، نتجاهل الخطأ ونكمل
                        console.log('لا يمكن حذف الرسالة:', deleteError.message);
                    }
                }

                await this.handleCallback(action, chatId, userId);

                // محاولة الرد على callback query مع معالجة الأخطاء
                try {
                    await this.bot.answerCallbackQuery(callbackQuery.id);
                } catch (answerError) {
                    console.log('تجاهل خطأ answerCallbackQuery:', answerError.message);
                }
            } catch (error) {
                console.error('خطأ في معالجة الCallback:', error);
                try {
                    await this.bot.answerCallbackQuery(callbackQuery.id, {
                        text: 'حدث خطأ، يرجى المحاولة مرة أخرى',
                        show_alert: true
                    });
                } catch (answerError) {
                    console.log('تجاهل خطأ answerCallbackQuery في catch:', answerError.message);
                }
            }
        });
    }

    setupBotManagerEvents() {
        this.botManager.on('botConnected', async (data) => {
            console.log(`✅ البوت ${data.botName} متصل بنجاح`);

            // إرسال إشعار للمستخدم
            try {
                const botData = await this.db.getBot(data.botId);
                if (botData) {
                    const user = await this.db.getUserById(botData.user_id);
                    if (user) {
                        // حذف جميع رسائل التحذير المحفوظة أولاً
                        console.log(`🗑️ حذف رسائل التحذير للبوت ${data.botId} من المحادثة ${user.telegram_id}`);
                        await this.deleteWarningMessages(user.telegram_id, data.botId);

                        // انتظار قصير للتأكد من حذف الرسائل
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // تنظيف المحادثة أولاً (حذف جميع الرسائل عدا الترحيب)
                        await this.cleanChat(user.telegram_id);

                        // إرسال رسالة الاتصال الناجح
                        const connectionMsg = await this.bot.sendMessage(user.telegram_id,
                            `✅ **البوت متصل بالسيرفر بنجاح!**\n\n` +
                            `🤖 **البوت:** ${data.botName}\n` +
                            `🌐 **السيرفر:** ${botData.server_host}:${botData.server_port}\n` +
                            `🎮 **النوع:** ${botData.edition === 'java' ? 'Java ☕' : 'Bedrock 🪨'}\n` +
                            `📦 **الإصدار:** ${botData.minecraft_version}\n\n` +
                            `🎯 **البوت الآن نشط ويلعب في السيرفر!**\n` +
                            `🌍 **ادخل العالم لرؤية البوت**\n\n` +
                            `💬 **يمكنك الآن التحكم في البوت:**`,
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: '💬 إرسال رسالة', callback_data: `bot_action_${data.botId}_send_message` },
                                            { text: '⚡ تنفيذ أمر', callback_data: `bot_action_${data.botId}_send_command` }
                                        ],
                                        [
                                            { text: '⚙️ إدارة البوت', callback_data: `bot_manage_${data.botId}` },
                                            { text: '⏹️ إيقاف البوت', callback_data: `bot_action_${data.botId}_stop` }
                                        ],
                                        [
                                            { text: '🤖 بوتاتي', callback_data: 'my_bots' },
                                            { text: '🏠 القائمة الرئيسية', callback_data: 'main_menu' }
                                        ]
                                    ]
                                }
                            }
                        );

                        // حفظ هذه الرسالة كآخر رسالة إجراء
                        await this.setLastActionMessage(user.telegram_id, connectionMsg.message_id);
                    }
                }
            } catch (error) {
                console.error('خطأ في إرسال إشعار الاتصال:', error);
            }
        });

        this.botManager.on('botDisconnected', async (data) => {
            console.log(`🔌 البوت ${data.botName} انقطع الاتصال`);
            // تم إزالة الإشعار القديم - النظام الآن يعتمد على نظام التحذيرات الجديد فقط
        });

        this.botManager.on('botError', async (data) => {
            // تجاهل أخطاء "Connect timed out" نهائياً
            if (data.error && data.error.includes('Connect timed out')) {
                return; // لا نطبع شيئاً ولا نرسل إشعار
            }

            console.error(`❌ خطأ في البوت ${data.botName}: ${data.error}`);

            // إرسال إشعار للمستخدم (للأخطاء المهمة فقط)
            try {
                const botData = await this.db.getBot(data.botId);
                if (botData) {
                    const user = await this.db.getUserById(botData.user_id);
                    if (user) {
                        let errorMessage = `❌ **خطأ في ${data.botName}**\n\n`;

                        // تحليل نوع الخطأ وإعطاء نصائح
                        if (data.error.includes('ENOTFOUND') || data.error.includes('getaddrinfo')) {
                            errorMessage += `🔍 لا يمكن العثور على السيرفر\n`;
                            errorMessage += `💡 تأكد من صحة عنوان السيرفر`;
                        } else if (data.error.includes('ECONNREFUSED')) {
                            errorMessage += `🔍 السيرفر رفض الاتصال\n`;
                            errorMessage += `💡 تأكد من أن السيرفر يعمل`;
                        } else if (data.error.includes('timeout')) {
                            errorMessage += `🔍 انتهت مهلة الاتصال\n`;
                            errorMessage += `💡 تأكد من الإنترنت أو جرب لاحقاً`;
                        } else if (data.error.includes('Xbox')) {
                            errorMessage += `🔍 السيرفر يتطلب Xbox\n`;
                            errorMessage += `💡 جرب سيرفر آخر`;
                        } else {
                            errorMessage += `🔍 ${data.error}`;
                        }

                        await this.bot.sendMessage(user.telegram_id, errorMessage, { parse_mode: 'Markdown' });
                    }
                }
            } catch (error) {
                console.error('خطأ في إرسال إشعار الخطأ:', error);
            }
        });

        // معالجة إشعارات انقطاع السيرفر
        this.botManager.on('serverDown', async (data) => {
            console.log(`📤 إرسال تحذير ${data.alertCount}/5 للمستخدم - البوت ${data.botName}`);

            try {
                const user = await this.db.getUserById(data.userId);
                if (user) {
                    // حفظ معرف رسالة التحذير لحذفها لاحقاً
                    const warningMsg = await this.bot.sendMessage(user.telegram_id,
                        `⚠️ **تحذير: مشكلة في الاتصال** (${data.alertCount}/5)\n\n` +
                        `🤖 البوت: ${data.botName}\n` +
                        `🌐 السيرفر: ${data.host}:${data.port}\n\n` +
                        `🔄 البوت يحاول إعادة الاتصال...\n` +
                        `💡 إذا استمرت المشكلة، تحقق من السيرفر\n\n` +
                        `⏰ سيتم إيقاف البوت نهائياً بعد ${5 - data.alertCount} تحذيرات أخرى`,
                        { parse_mode: 'Markdown' }
                    );

                    // حفظ معرف رسالة التحذير لحذفها لاحقاً
                    if (!this.warningMessages.has(data.botId)) {
                        this.warningMessages.set(data.botId, []);
                    }
                    this.warningMessages.get(data.botId).push(warningMsg.message_id);

                    console.log(`💾 تم حفظ معرف رسالة التحذير ${data.alertCount} للبوت ${data.botId}`);
                }
            } catch (error) {
                console.error('خطأ في إرسال إشعار انقطاع السيرفر:', error);
            }
        });

        // معالجة الإشعار النهائي لانقطاع السيرفر
        this.botManager.on('serverDownFinal', async (data) => {
            console.log(`🛑 إيقاف البوت ${data.botName} نهائياً - السيرفر غير شغال`);

            try {
                const user = await this.db.getUserById(data.userId);
                if (user) {
                    // حذف جميع رسائل التحذير السابقة أولاً
                    await this.deleteWarningMessages(user.telegram_id, data.botId);

                    // تنظيف شامل للمحادثة (حذف جميع الرسائل عدا رسالة الترحيب)
                    await this.cleanChat(user.telegram_id);

                    // إرسال الإشعار النهائي الأنيق والواضح
                    const finalMsg = await this.bot.sendMessage(user.telegram_id,
                        `🛑 **تم إيقاف البوت نهائياً**\n\n` +
                        `🤖 **البوت:** ${data.botName}\n` +
                        `🌐 **السيرفر:** ${data.host}:${data.port}\n\n` +
                        `❌ **السبب:** السيرفر غير متصل أو مطفي\n` +
                        `⚠️ **تم إرسال 5 تحذيرات** ولم يتم حل المشكلة\n\n` +
                        `📋 **للمتابعة:**\n` +
                        `1️⃣ تأكد من تشغيل السيرفر أو العالم\n` +
                        `2️⃣ تأكد من الاتصال بالإنترنت\n` +
                        `3️⃣ اضغط الزر أدناه لإعادة تشغيل البوت\n\n` +
                        `💡 **نصيحة:** تأكد من أن السيرفر يعمل قبل إعادة التشغيل`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '🔄 إعادة تشغيل البوت', callback_data: `bot_action_${data.botId}_start` }
                                    ],
                                    [
                                        { text: '⚙️ إدارة البوت', callback_data: `bot_manage_${data.botId}` },
                                        { text: '🌐 تغيير السيرفر', callback_data: `bot_action_${data.botId}_edit_server` }
                                    ],
                                    [
                                        { text: '🤖 بوتاتي', callback_data: 'my_bots' },
                                        { text: '🏠 القائمة الرئيسية', callback_data: 'main_menu' }
                                    ]
                                ]
                            }
                        }
                    );

                    // حفظ معرف رسالة الإيقاف النهائي
                    this.finalNotificationMessages.set(data.botId, finalMsg.message_id);
                    console.log(`💾 تم حفظ معرف رسالة الإيقاف النهائي للبوت ${data.botId}`);

                    // حفظ رسالة الإيقاف النهائي كآخر رسالة إجراء
                    await this.setLastActionMessage(user.telegram_id, finalMsg.message_id);
                    console.log(`✅ المحادثة نظيفة الآن - تحتوي على رسالة الترحيب ورسالة الإيقاف النهائي فقط`);
                }
            } catch (error) {
                console.error('خطأ في إرسال الإشعار النهائي:', error);
            }
        });

        this.botManager.on('botChat', (data) => {
            console.log(`💬 ${data.botName} - ${data.username}: ${data.message}`);
        });
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username;

        try {
            // إنشاء أو تحديث المستخدم في قاعدة البيانات
            await this.db.createUser(userId, username);

            // التأكد من وجود رسالة الترحيب أو إرسالها
            await this.ensureWelcomeMessage(chatId, userId);



        } catch (error) {
            console.error('خطأ في handleStart:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة مرة أخرى');
        }
    }

    async handleNewBot(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            // التحقق من وجود المستخدم
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ يرجى البدء بالأمر /start أولاً');
                return;
            }

            // عرض خيارات نوع ماينكرافت
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '☕ Java Edition', callback_data: 'edition_java' },
                        { text: '🪨 Bedrock Edition', callback_data: 'edition_bedrock' }
                    ],
                    [
                        { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
                    ]
                ]
            };

            await this.bot.sendMessage(chatId,
                '🎮 *إنشاء بوت جديد*\n\n' +
                '🔥 *اختر نوع اللعبة:*\n\n' +
                '☕ **Java Edition**\n' +
                '🖥️ للكمبيوتر والـ PC\n' +
                '🌐 معظم السيرفرات\n\n' +
                '🪨 **Bedrock Edition**\n' +
                '📱 للجوال والكونسول\n' +
                '🎮 Xbox, PlayStation',
                {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                }
            );

        } catch (error) {
            console.error('خطأ في handleNewBot:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة مرة أخرى');
        }
    }

    async handleMyBots(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ يرجى البدء بالأمر /start أولاً');
                return;
            }

            const result = await this.botManager.getUserBots(user.id);
            if (!result.success) {
                await this.bot.sendMessage(chatId, `❌ ${result.error}`);
                return;
            }

            const bots = result.data;
            if (bots.length === 0) {
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '🚀 إنشاء بوت', callback_data: 'new_bot' }
                        ],
                        [
                            { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
                        ]
                    ]
                };

                const noBotsMsg = await this.bot.sendMessage(chatId,
                    '🤖 *لا توجد بوتات*\n\n' +
                    'ابدأ بإنشاء بوت جديد!',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    }
                );

                // حفظ رسالة "لا توجد بوتات" كآخر رسالة إجراء
                await this.setLastActionMessage(chatId, noBotsMsg.message_id);
                return;
            }

            let message = '🤖 **بوتاتك:**\n\n';
            const keyboard = { inline_keyboard: [] };

            bots.forEach((bot) => {
                const statusEmoji = bot.status === 'running' ? '🟢' :
                                  bot.status === 'stopped' ? '🔴' : '🟡';
                const statusText = bot.status === 'running' ? 'نشط' : 'متوقف';
                const editionEmoji = bot.edition === 'java' ? '☕' : '🪨';

                message += `┌─────────────────────────┐\n`;
                message += `│ ${statusEmoji} **${bot.name}** (${statusText})\n`;
                message += `│ 🌐 ${bot.host}:${bot.port}\n`;
                message += `│ ${editionEmoji} ${bot.edition === 'java' ? 'Java' : 'Bedrock'} ${bot.version}\n`;
                message += `└─────────────────────────┘\n\n`;

                // إضافة أزرار سريعة لكل بوت
                const botButtons = [
                    { text: `⚙️ ${bot.name}`, callback_data: `bot_manage_${bot.id}` }
                ];

                if (bot.status === 'running') {
                    botButtons.push({ text: `⏹️ إيقاف`, callback_data: `bot_action_${bot.id}_stop` });
                } else {
                    botButtons.push({ text: `▶️ تشغيل`, callback_data: `bot_action_${bot.id}_start` });
                }

                keyboard.inline_keyboard.push(botButtons);
            });

            // إضافة أزرار إضافية
            keyboard.inline_keyboard.push([
                { text: '🆕 إنشاء بوت', callback_data: 'new_bot' }
            ]);

            if (bots.length > 0) {
                keyboard.inline_keyboard.push([
                    { text: '🗑️ مسح الكل', callback_data: 'user_clear_all_bots' }
                ]);
            }

            keyboard.inline_keyboard.push([
                { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
            ]);

            const myBotsMsg = await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

            // حفظ قائمة البوتات كآخر رسالة إجراء
            await this.setLastActionMessage(chatId, myBotsMsg.message_id);

        } catch (error) {
            console.error('خطأ في handleMyBots:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة مرة أخرى');
        }
    }

    async handleStats(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ يرجى البدء بالأمر /start أولاً');
                return;
            }

            // إحصائيات المستخدم
            const userBotsResult = await this.botManager.getUserBots(user.id);
            const userBots = userBotsResult.success ? userBotsResult.data : [];

            const activeBots = userBots.filter(bot => bot.status === 'running').length;
            const totalBots = userBots.length;

            let message = `📊 **إحصائياتك:**\n\n`;
            message += `🤖 إجمالي البوتات: ${totalBots}\n`;
            message += `🟢 البوتات النشطة: ${activeBots}\n`;
            message += `🔴 البوتات المتوقفة: ${totalBots - activeBots}\n`;

            // إحصائيات عامة للأدمن
            if (this.adminIds.includes(userId)) {
                const generalStats = await this.botManager.getGeneralStats();
                if (generalStats.success) {
                    message += `\n📈 **الإحصائيات العامة:**\n`;
                    message += `👥 المستخدمين: ${generalStats.data.totalUsers}\n`;
                    message += `🤖 إجمالي البوتات: ${generalStats.data.totalBots}\n`;
                    message += `🟢 البوتات النشطة: ${generalStats.data.activeBotsCount}\n`;
                }
            }

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🤖 بوتاتي', callback_data: 'my_bots' },
                        { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
                    ]
                ]
            };

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('خطأ في handleStats:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة مرة أخرى');
        }
    }

    async handleHelp(msg) {
        const chatId = msg.chat.id;

        const helpMessage = `📚 *دليل المساعدة*

🎮 **الأوامر الأساسية:**
• /start - بدء استخدام البوت
• /newbot - إنشاء بوت جديد
• /mybots - عرض بوتاتك
• /stats - الإحصائيات

📋 **خطوات إنشاء بوت:**
1️⃣ اختر نوع ماينكرافت
2️⃣ اختر الإصدار
3️⃣ أدخل عنوان السيرفر
4️⃣ أدخل اسم البوت
5️⃣ اضغط تشغيل

🎯 **الإصدارات المدعومة:**
☕ Java: 1.21.1, 1.21.0, 1.20.6
🪨 Bedrock: 1.21.93, 1.21.90, 1.21.80

💡 **نصائح:**
• حد أقصى 3 بوتات لكل مستخدم
• دعم جميع السيرفرات
• تحكم كامل في البوتات
• إرسال رسائل وأوامر`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚀 إنشاء بوت', callback_data: 'new_bot' },
                    { text: '🤖 بوتاتي', callback_data: 'my_bots' }
                ],
                [
                    { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId, helpMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;
        const messageId = msg.message_id;

        // تجاهل الأوامر
        if (text && text.startsWith('/')) {
            return;
        }

        // معالجة حالات المحادثة
        const userState = this.userStates.get(userId);
        if (userState) {
            // حذف رسالة المستخدم لجعل المحادثة أكثر نظافة
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (deleteError) {
                // في حالة فشل الحذف، نتجاهل الخطأ ونكمل
                console.log('لا يمكن حذف رسالة المستخدم:', deleteError.message);
            }

            await this.handleUserInput(chatId, userId, text, userState);
        }
    }

    async handleCallback(action, chatId, userId) {
        if (action === 'main_menu') {
            // لا نحذف رسالة الترحيب، فقط نرسل رسالة جديدة
            await this.handleStart({ chat: { id: chatId }, from: { id: userId } });
            return;
        }

        if (action === 'new_bot') {
            await this.handleNewBot({ chat: { id: chatId }, from: { id: userId } });
            return;
        }

        if (action === 'my_bots') {
            await this.refreshMyBots(chatId, userId);
            return;
        }

        if (action === 'stats') {
            await this.handleStats({ chat: { id: chatId }, from: { id: userId } });
            return;
        }

        if (action === 'help') {
            await this.handleHelp({ chat: { id: chatId } });
            return;
        }

        if (action.startsWith('edition_')) {
            await this.handleEditionSelection(chatId, userId, action.split('_')[1]);
            return;
        }

        if (action.startsWith('version_')) {
            await this.handleVersionSelection(chatId, userId, action);
            return;
        }

        if (action.startsWith('bot_manage_')) {
            const botId = parseInt(action.split('_')[2]);
            await this.handleBotManagement(chatId, userId, botId);
            return;
        }

        if (action.startsWith('bot_action_')) {
            // تقسيم صحيح: bot_action_3_edit_name -> botId=3, actionType=edit_name
            const match = action.match(/^bot_action_(\d+)_(.+)$/);
            if (match) {
                const botId = parseInt(match[1]);
                const actionType = match[2];
                await this.handleBotAction(chatId, userId, botId, actionType);
            } else {
                console.log(`❌ خطأ في تحليل bot_action: ${action}`);
            }
            return;
        }

        if (action === 'admin_panel') {
            await this.handleAdminPanel(chatId, userId);
            return;
        }

        if (action.startsWith('admin_')) {
            await this.handleAdminAction(chatId, userId, action);
            return;
        }

        if (action === 'user_clear_all_bots') {
            await this.handleUserClearAllBots(chatId, userId);
            return;
        }

        if (action === 'user_confirm_clear_all') {
            await this.clearUserBots(chatId, userId);
            return;
        }
    }

    async handleEditionSelection(chatId, userId, edition) {
        const versions = this.botManager.getSupportedVersions()[edition];

        const keyboard = { inline_keyboard: [] };

        // إضافة أزرار الإصدارات
        for (let i = 0; i < versions.length; i += 2) {
            const row = [];
            row.push({ text: versions[i], callback_data: `version_${edition}_${versions[i]}` });
            if (versions[i + 1]) {
                row.push({ text: versions[i + 1], callback_data: `version_${edition}_${versions[i + 1]}` });
            }
            keyboard.inline_keyboard.push(row);
        }

        keyboard.inline_keyboard.push([
            { text: '🔙 العودة', callback_data: 'new_bot' }
        ]);

        const editionName = edition === 'java' ? 'Java Edition' : 'Bedrock Edition';
        await this.bot.sendMessage(chatId,
            `🎮 *${editionName}*\n\nاختر الإصدار المناسب:`,
            {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );
    }

    async handleVersionSelection(chatId, userId, action) {
        const [, edition, version] = action.split('_');

        // حفظ حالة المستخدم
        this.userStates.set(userId, {
            step: 'waiting_host',
            edition,
            version
        });

        await this.bot.sendMessage(chatId,
            `🌐 **أدخل عنوان السيرفر:**\n\n` +
            `مثال: play.example.com\n` +
            `أو: 192.168.1.100\n\n` +
            `💡 يمكنك استخدام أي سيرفر`,
            { parse_mode: 'Markdown' }
        );
    }

    async handleUserInput(chatId, userId, text, userState) {
        try {
            switch (userState.step) {
                case 'waiting_host':
                    if (!text || text.trim().length === 0) {
                        await this.bot.sendMessage(chatId, '❌ يرجى إدخال عنوان السيرفر');
                        return;
                    }

                    userState.host = text.trim();
                    userState.step = 'waiting_port';

                    await this.bot.sendMessage(chatId,
                        `🔌 **أدخل رقم البورت:**\n\n` +
                        `Java: عادة 25565\n` +
                        `Bedrock: عادة 19132\n\n` +
                        `💡 إذا لم تكن متأكداً، استخدم الافتراضي`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'waiting_port':
                    const port = parseInt(text);
                    if (isNaN(port) || port < 1 || port > 65535) {
                        await this.bot.sendMessage(chatId, '❌ رقم البورت غير صحيح. يجب أن يكون بين 1 و 65535');
                        return;
                    }

                    userState.port = port;
                    userState.step = 'waiting_name';

                    await this.bot.sendMessage(chatId,
                        `🤖 **أدخل اسم البوت:**\n\n` +
                        `هذا الاسم سيظهر في السيرفر\n\n` +
                        `💡 اختر اسماً مناسباً (1-16 حرف)`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'waiting_name':
                    if (!text || text.trim().length === 0) {
                        await this.bot.sendMessage(chatId, '❌ يرجى إدخال اسم البوت');
                        return;
                    }

                    if (text.trim().length > 16) {
                        await this.bot.sendMessage(chatId, '❌ اسم البوت يجب أن يكون أقل من 16 حرف');
                        return;
                    }

                    userState.name = text.trim();
                    await this.createBotFromUserState(chatId, userId, userState);
                    break;

                case 'edit_server_host':
                    if (!text || text.trim().length === 0) {
                        await this.bot.sendMessage(chatId, '❌ يرجى إدخال عنوان السيرفر');
                        return;
                    }

                    userState.newHost = text.trim();
                    userState.step = 'edit_server_port';

                    await this.bot.sendMessage(chatId,
                        `🔌 *أدخل رقم البورت الجديد:*\n\n` +
                        `البورت الحالي: \`${userState.currentBot.port}\`\n\n` +
                        `للـ Java Edition: عادة 25565\n` +
                        `للـ Bedrock Edition: عادة 19132`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'edit_server_port':
                    const newPort = parseInt(text);
                    if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
                        await this.bot.sendMessage(chatId, '❌ رقم البورت غير صحيح. يجب أن يكون بين 1 و 65535');
                        return;
                    }

                    userState.newPort = newPort;
                    await this.updateBotServer(chatId, userId, userState);
                    break;

                case 'waiting_message':
                    await this.sendBotMessage(chatId, userId, userState.botId, text);
                    break;

                case 'waiting_command':
                    await this.executeBotCommand(chatId, userId, userState.botId, text);
                    break;

                case 'waiting_broadcast_message':
                    await this.sendBroadcastMessage(chatId, userId, text);
                    break;

                case 'edit_bot_name':
                    const newName = text.trim();

                    // التحقق من صحة الاسم
                    if (!newName || newName.length === 0) {
                        await this.bot.sendMessage(chatId,
                            '❌ **خطأ في الاسم**\n\n' +
                            'يرجى إدخال اسم البوت الجديد\n\n' +
                            '📝 اكتب اسم البوت (1-16 حرف):'
                        );
                        return;
                    }

                    if (newName.length > 16) {
                        await this.bot.sendMessage(chatId,
                            '❌ **الاسم طويل جداً**\n\n' +
                            `الاسم المدخل: ${newName.length} حرف\n` +
                            'الحد الأقصى: 16 حرف\n\n' +
                            '📝 اكتب اسم أقصر:'
                        );
                        return;
                    }

                    // تحديث اسم البوت
                    await this.updateBotName(chatId, userId, userState, newName);
                    break;
            }
        } catch (error) {
            console.error('خطأ في handleUserInput:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ، يرجى المحاولة مرة أخرى');
            this.userStates.delete(userId);
        }
    }

    async createBotFromUserState(chatId, userId, userState) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام، يرجى البدء بـ /start');
                this.userStates.delete(userId);
                return;
            }

            const botConfig = {
                name: userState.name,
                host: userState.host,
                port: userState.port,
                version: userState.version,
                edition: userState.edition
            };

            await this.bot.sendMessage(chatId, '🔄 جاري إنشاء البوت...');

            const result = await this.botManager.createBot(user.id, botConfig);

            if (result.success) {
                const editionName = userState.edition === 'java' ? 'Java' : 'Bedrock';
                const successMessage = `🎉 **تم إنشاء البوت بنجاح!**

🤖 **الاسم:** ${userState.name}
🌐 **السيرفر:** ${userState.host}:${userState.port}
🎮 **النوع:** ${editionName} ${userState.version}

✨ البوت جاهز للتشغيل!`;

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '▶️ تشغيل الآن', callback_data: `bot_action_${result.botId}_start` }
                        ],
                        [
                            { text: '🤖 بوتاتي', callback_data: 'my_bots' },
                            { text: '🆕 إنشاء آخر', callback_data: 'new_bot' }
                        ],
                        [
                            { text: '🏠 القائمة الرئيسية', callback_data: 'main_menu' }
                        ]
                    ]
                };

                await this.bot.sendMessage(chatId, successMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } else {
                await this.bot.sendMessage(chatId, `❌ فشل في إنشاء البوت: ${result.error}`);
            }

            this.userStates.delete(userId);

        } catch (error) {
            console.error('خطأ في createBotFromUserState:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في إنشاء البوت');
            this.userStates.delete(userId);
        }
    }

    async handleBotManagement(chatId, userId, botId) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                return;
            }

            const result = await this.botManager.getBotInfo(botId);
            if (!result.success) {
                await this.bot.sendMessage(chatId, `❌ ${result.error}`);
                return;
            }

            const bot = result.data;
            const statusEmoji = bot.connected ? '🟢' : '🔴';
            const statusText = bot.connected ? 'متصل' : 'غير متصل';
            const editionName = bot.edition === 'java' ? 'Java' : 'Bedrock';

            let message = `🎮 **إدارة البوت: ${bot.name}**\n\n`;
            message += `${statusEmoji} **الحالة:** ${statusText}\n`;
            message += `🌐 **السيرفر:** ${bot.host}:${bot.port}\n`;
            message += `🎮 **النوع:** ${editionName} ${bot.version}\n`;

            if (bot.connected) {
                message += `⏱️ **وقت التشغيل:** ${Math.round(bot.uptime / 60000)} دقيقة\n`;
                if (bot.position) {
                    message += `📍 **الموقع:** ${Math.round(bot.position.x)}, ${Math.round(bot.position.y)}, ${Math.round(bot.position.z)}\n`;
                }
            }

            message += `\n💡 **نصيحة:** يمكنك تغيير اسم البوت الذي سيظهر في السيرفر`;

            // إنشاء الأزرار بناءً على حالة البوت
            const keyboard = { inline_keyboard: [] };

            if (bot.connected) {
                keyboard.inline_keyboard.push([
                    { text: '⏹️ إيقاف البوت', callback_data: `bot_action_${botId}_stop` }
                ]);
                keyboard.inline_keyboard.push([
                    { text: '💬 إرسال رسالة', callback_data: `bot_action_${botId}_send_message` },
                    { text: '⚡ تنفيذ أمر', callback_data: `bot_action_${botId}_send_command` }
                ]);
            } else {
                keyboard.inline_keyboard.push([
                    { text: '▶️ تشغيل البوت', callback_data: `bot_action_${botId}_start` }
                ]);
            }

            keyboard.inline_keyboard.push([
                { text: '✏️ تغيير الاسم', callback_data: `bot_action_${botId}_edit_name` },
                { text: '🌐 تغيير السيرفر', callback_data: `bot_action_${botId}_edit_server` }
            ]);

            keyboard.inline_keyboard.push([
                { text: '🗑️ حذف البوت', callback_data: `bot_action_${botId}_delete` }
            ]);

            keyboard.inline_keyboard.push([
                { text: '🔙 بوتاتي', callback_data: 'my_bots' }
            ]);

            const managementMsg = await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

            // حفظ رسالة إدارة البوت كآخر رسالة إجراء
            await this.setLastActionMessage(chatId, managementMsg.message_id);

        } catch (error) {
            console.error('خطأ في handleBotManagement:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ');
        }
    }

    async handleBotAction(chatId, userId, botId, action) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                return;
            }

            switch (action) {
                case 'start':
                    // إرسال رسالة "جاري التشغيل" وحفظ معرفها
                    const loadingStartMsg = await this.bot.sendMessage(chatId, '🔄 جاري تشغيل البوت...');
                    this.loadingMessages.set(botId, loadingStartMsg.message_id);

                    const startResult = await this.botManager.startBot(botId);

                    // حذف رسالة "جاري التشغيل"
                    await this.deleteLoadingMessage(chatId, botId);

                    if (startResult.success) {
                        // تنظيف المحادثة قبل إرسال رسالة النجاح
                        await this.cleanChat(chatId);

                        const successMsg = await this.bot.sendMessage(chatId, '✅ تم تشغيل البوت بنجاح!');

                        // انتظار ثم حذف رسالة النجاح
                        setTimeout(async () => {
                            try {
                                await this.bot.deleteMessage(chatId, successMsg.message_id);
                            } catch (error) {
                                // تجاهل أخطاء الحذف
                            }
                        }, 2000);
                    } else {
                        await this.bot.sendMessage(chatId, `❌ فشل في تشغيل البوت: ${startResult.error}`);
                    }
                    break;

                case 'stop':
                    // إرسال رسالة "جاري الإيقاف" وحفظ معرفها
                    const loadingStopMsg = await this.bot.sendMessage(chatId, '🔄 جاري إيقاف البوت...');
                    this.loadingMessages.set(botId, loadingStopMsg.message_id);

                    const stopResult = await this.botManager.stopBot(botId);

                    // حذف رسالة "جاري الإيقاف"
                    await this.deleteLoadingMessage(chatId, botId);

                    if (stopResult.success) {
                        // تنظيف المحادثة قبل إرسال رسالة النجاح
                        await this.cleanChat(chatId);

                        const successMsg = await this.bot.sendMessage(chatId, '✅ تم إيقاف البوت بنجاح!');

                        // انتظار ثم حذف رسالة النجاح
                        setTimeout(async () => {
                            try {
                                await this.bot.deleteMessage(chatId, successMsg.message_id);
                            } catch (error) {
                                // تجاهل أخطاء الحذف
                            }
                        }, 2000);
                    } else {
                        await this.bot.sendMessage(chatId, `❌ فشل في إيقاف البوت: ${stopResult.error}`);
                    }
                    break;

                case 'delete':
                    const keyboard = {
                        inline_keyboard: [
                            [
                                { text: '✅ نعم، احذف', callback_data: `bot_action_${botId}_confirm_delete` },
                                { text: '❌ إلغاء', callback_data: `bot_manage_${botId}` }
                            ]
                        ]
                    };

                    await this.bot.sendMessage(chatId,
                        '⚠️ **تأكيد الحذف**\n\nهل أنت متأكد من حذف هذا البوت؟\nلا يمكن التراجع عن هذا الإجراء.',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: keyboard
                        }
                    );
                    break;

                case 'edit_name':
                    // الحصول على معلومات البوت
                    const botInfoForName = await this.botManager.getBotInfo(botId);
                    if (!botInfoForName.success) {
                        await this.bot.sendMessage(chatId, `❌ ${botInfoForName.error}`);
                        return;
                    }

                    // حفظ حالة المستخدم
                    this.userStates.set(userId, {
                        step: 'edit_bot_name',
                        botId: botId,
                        currentBot: botInfoForName.data
                    });

                    // إرسال رسالة طلب الاسم الجديد
                    await this.bot.sendMessage(
                        chatId,
                        `✏️ **تغيير اسم البوت**\n\n` +
                        `🤖 الاسم الحالي: \`${botInfoForName.data.name}\`\n\n` +
                        `📝 اكتب اسم البوت الجديد:\n` +
                        `(من 1 إلى 16 حرف)\n\n` +
                        `💡 هذا الاسم سيظهر في سيرفر ماينكرافت عند دخول البوت`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'edit_server':
                    // الحصول على معلومات البوت
                    const botInfoForServer = await this.botManager.getBotInfo(botId);
                    if (!botInfoForServer.success) {
                        await this.bot.sendMessage(chatId, `❌ ${botInfoForServer.error}`);
                        return;
                    }

                    this.userStates.set(userId, {
                        step: 'edit_server_host',
                        botId: botId,
                        currentBot: botInfoForServer.data
                    });

                    await this.bot.sendMessage(
                        chatId,
                        `🌐 **تحديث السيرفر**\n\n` +
                        `السيرفر الحالي: \`${botInfoForServer.data.host}:${botInfoForServer.data.port}\`\n\n` +
                        `أدخل عنوان السيرفر الجديد:`,
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'confirm_delete':
                    // الحصول على معلومات المستخدم
                    const userForDelete = await this.db.getUser(userId);
                    if (!userForDelete) {
                        await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                        return;
                    }

                    const deleteResult = await this.botManager.deleteBot(botId, userForDelete.id);

                    if (deleteResult.success) {
                        await this.bot.sendMessage(chatId, '✅ تم حذف البوت بنجاح!');
                        await this.handleMyBots({ chat: { id: chatId }, from: { id: userId } });
                    } else {
                        await this.bot.sendMessage(chatId, `❌ فشل في حذف البوت: ${deleteResult.error}`);
                    }
                    break;

                case 'message':
                    this.userStates.set(userId, {
                        step: 'waiting_message',
                        botId: botId
                    });

                    await this.bot.sendMessage(chatId,
                        '💬 **إرسال رسالة**\n\nاكتب الرسالة التي تريد إرسالها:',
                        { parse_mode: 'Markdown' }
                    );
                    break;

                case 'command':
                    this.userStates.set(userId, {
                        step: 'waiting_command',
                        botId: botId
                    });

                    await this.bot.sendMessage(chatId,
                        '⚡ **تنفيذ أمر**\n\nاكتب الأمر (بدون /):\nمثال: help, tp, give',
                        { parse_mode: 'Markdown' }
                    );
                    break;
            }

        } catch (error) {
            console.error('خطأ في handleBotAction:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ');
        }
    }

    async sendBotMessage(chatId, userId, botId, message) {
        try {
            const result = await this.botManager.sendMessage(botId, message);

            if (result.success) {
                await this.bot.sendMessage(chatId, `✅ تم إرسال: "${message}"`);
            } else {
                await this.bot.sendMessage(chatId, `❌ فشل الإرسال: ${result.error}`);
            }

            this.userStates.delete(userId);

        } catch (error) {
            console.error('خطأ في sendBotMessage:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في إرسال الرسالة');
            this.userStates.delete(userId);
        }
    }

    async executeBotCommand(chatId, userId, botId, command) {
        try {
            const result = await this.botManager.executeCommand(botId, command);

            if (result.success) {
                await this.bot.sendMessage(chatId, `✅ تم تنفيذ: "/${command}"`);
            } else {
                await this.bot.sendMessage(chatId, `❌ فشل التنفيذ: ${result.error}`);
            }

            this.userStates.delete(userId);

        } catch (error) {
            console.error('خطأ في executeBotCommand:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في تنفيذ الأمر');
            this.userStates.delete(userId);
        }
    }

    async updateBotName(chatId, userId, userState, newName) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                return;
            }

            const { botId, currentBot } = userState;

            // رسالة التحديث
            await this.bot.sendMessage(chatId,
                `🔄 **جاري تحديث اسم البوت...**\n\n` +
                `🤖 من: \`${currentBot.name}\`\n` +
                `🤖 إلى: \`${newName}\`\n\n` +
                `⏳ يرجى الانتظار...`,
                { parse_mode: 'Markdown' }
            );

            // تحديث اسم البوت باستخدام bot-manager
            const updateResult = await this.botManager.updateBotName(botId, newName);

            if (updateResult.success) {
                // تنظيف المحادثة قبل إرسال رسالة النجاح
                await this.cleanChat(chatId);

                const successMsg = await this.bot.sendMessage(chatId,
                    `✅ **تم تحديث اسم البوت بنجاح!**\n\n` +
                    `🤖 الاسم الجديد: \`${newName}\`\n\n` +
                    `🎮 البوت الآن سيدخل سيرفر ماينكرافت بالاسم الجديد\n\n` +
                    `💡 إذا كان البوت يعمل، تم إعادة تشغيله تلقائياً`,
                    { parse_mode: 'Markdown' }
                );

                // حفظ رسالة النجاح كآخر رسالة إجراء
                await this.setLastActionMessage(chatId, successMsg.message_id);

                // انتظار قصير ثم حذف رسالة النجاح
                setTimeout(async () => {
                    try {
                        await this.bot.deleteMessage(chatId, successMsg.message_id);
                    } catch (error) {
                        // تجاهل أخطاء الحذف
                    }
                }, 3000);
            } else {
                await this.bot.sendMessage(chatId,
                    `❌ **فشل في تحديث الاسم**\n\n` +
                    `السبب: ${updateResult.error}\n\n` +
                    `يرجى المحاولة مرة أخرى`
                );
            }

            // إزالة حالة المستخدم
            this.userStates.delete(userId);

        } catch (error) {
            console.error('خطأ في updateBotName:', error);
            await this.bot.sendMessage(chatId,
                '❌ **حدث خطأ في تحديث الاسم**\n\n' +
                'يرجى المحاولة مرة أخرى لاحقاً'
            );
            this.userStates.delete(userId);
        }
    }

    async updateBotServer(chatId, userId, userState) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                return;
            }

            const { botId, newHost, newPort } = userState;

            // إيقاف البوت إذا كان يعمل
            const stopResult = await this.botManager.stopBot(botId);

            // تحديث بيانات السيرفر في قاعدة البيانات
            const updateResult = await this.db.updateBotServer(botId, newHost, newPort);

            if (updateResult) {
                await this.bot.sendMessage(chatId,
                    `✅ **تم تحديث السيرفر!**\n\n` +
                    `🌐 العنوان الجديد: \`${newHost}:${newPort}\`\n\n` +
                    `يمكنك تشغيل البوت الآن.`,
                    { parse_mode: 'Markdown' }
                );

                // لا نعرض قائمة الإدارة تلقائياً
            } else {
                await this.bot.sendMessage(chatId, '❌ فشل في تحديث السيرفر');
            }

            // إزالة حالة المستخدم
            this.userStates.delete(userId);

        } catch (error) {
            console.error('خطأ في updateBotServer:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في تحديث السيرفر');
            this.userStates.delete(userId);
        }
    }

    // أوامر الأدمن
    async handleAdmin(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!this.adminIds.includes(userId)) {
            await this.bot.sendMessage(chatId, '❌ ليس لديك صلاحية للوصول لهذا الأمر');
            return;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '👥 جميع المستخدمين', callback_data: 'admin_users' },
                    { text: '🤖 جميع البوتات', callback_data: 'admin_bots' }
                ],
                [
                    { text: '📊 الإحصائيات العامة', callback_data: 'admin_stats' },
                    { text: '📢 إرسال إعلان', callback_data: 'admin_broadcast' }
                ],
                [
                    { text: '⚙️ الإعدادات', callback_data: 'admin_settings' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId,
            '🔧 *لوحة تحكم الأدمن*\n\nاختر الإجراء المطلوب:',
            {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );
    }

    // إضافة أدمن جديد
    async addAdmin(userId) {
        if (!this.adminIds.includes(userId)) {
            this.adminIds.push(userId);
            await this.db.setAdmin(userId, true);
            console.log(`✅ تم إضافة أدمن جديد: ${userId}`);
        }
    }

    // إزالة أدمن
    async removeAdmin(userId) {
        const index = this.adminIds.indexOf(userId);
        if (index > -1) {
            this.adminIds.splice(index, 1);
            await this.db.setAdmin(userId, false);
            console.log(`❌ تم إزالة الأدمن: ${userId}`);
        }
    }

    // تحميل قائمة الأدمن من قاعدة البيانات
    async loadAdmins() {
        try {
            // يمكن إضافة استعلام لجلب الأدمن من قاعدة البيانات
            // هنا سنضع أدمن افتراضي
            console.log('📋 تم تحميل قائمة الأدمن');
        } catch (error) {
            console.error('خطأ في تحميل الأدمن:', error);
        }
    }

    // وظائف الأدمن
    async handleAdminPanel(chatId, userId) {
        if (!this.adminIds.includes(userId)) {
            await this.bot.sendMessage(chatId, '❌ ليس لديك صلاحية للوصول لهذا الأمر');
            return;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '👥 عرض المستخدمين', callback_data: 'admin_users' },
                    { text: '🤖 عرض جميع البوتات', callback_data: 'admin_bots' }
                ],
                [
                    { text: '📊 إحصائيات النظام', callback_data: 'admin_stats' },
                    { text: '📢 إرسال رسالة جماعية', callback_data: 'admin_broadcast' }
                ],
                [
                    { text: '🗑️ مسح جميع البوتات', callback_data: 'admin_clear_all_bots' },
                    { text: '🧹 تنظيف قاعدة البيانات', callback_data: 'admin_cleanup_db' }
                ],
                [
                    { text: '🔄 إعادة تشغيل النظام', callback_data: 'admin_restart' },
                    { text: '⛔ إيقاف النظام', callback_data: 'admin_shutdown' }
                ],
                [
                    { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId,
            '⚙️ *لوحة إدارة النظام*\n\nاختر العملية التي تريد تنفيذها:',
            {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );
    }

    async handleAdminAction(chatId, userId, action) {
        if (!this.adminIds.includes(userId)) {
            await this.bot.sendMessage(chatId, '❌ ليس لديك صلاحية للوصول لهذا الأمر');
            return;
        }

        switch (action) {
            case 'admin_shutdown':
                const shutdownKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ نعم، أوقف النظام', callback_data: 'admin_confirm_shutdown' },
                            { text: '❌ إلغاء', callback_data: 'admin_panel' }
                        ]
                    ]
                };

                await this.bot.sendMessage(chatId,
                    '⚠️ *تأكيد إيقاف النظام*\n\nهل أنت متأكد من إيقاف النظام بالكامل؟\n\n❗ سيتم إيقاف جميع البوتات وإغلاق النظام.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: shutdownKeyboard
                    }
                );
                break;

            case 'admin_confirm_shutdown':
                await this.bot.sendMessage(chatId, '🔄 جاري إيقاف النظام...');

                try {
                    // إيقاف جميع البوتات
                    await this.botManager.shutdown();

                    await this.bot.sendMessage(chatId, '✅ تم إيقاف جميع البوتات بنجاح\n🔄 جاري إغلاق النظام...');

                    // إيقاف النظام
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);

                } catch (error) {
                    await this.bot.sendMessage(chatId, `❌ خطأ في إيقاف النظام: ${error.message}`);
                }
                break;

            case 'admin_restart':
                await this.bot.sendMessage(chatId, '🔄 إعادة تشغيل النظام (قيد التطوير)');
                break;

            case 'admin_users':
                await this.handleAllUsers(chatId, userId);
                break;

            case 'admin_bots':
                await this.handleAllBotsAdmin(chatId, userId);
                break;

            case 'admin_stats':
                await this.handleSystemStats(chatId, userId);
                break;

            case 'admin_broadcast':
                this.userStates.set(userId, {
                    step: 'waiting_broadcast_message'
                });

                await this.bot.sendMessage(chatId,
                    '📢 *إرسال رسالة جماعية*\n\nاكتب الرسالة التي تريد إرسالها لجميع المستخدمين:',
                    { parse_mode: 'Markdown' }
                );
                break;

            case 'admin_clear_all_bots':
                const clearAllKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ نعم، امسح جميع البوتات', callback_data: 'admin_confirm_clear_all' },
                            { text: '❌ إلغاء', callback_data: 'admin_panel' }
                        ]
                    ]
                };

                await this.bot.sendMessage(chatId,
                    '⚠️ *تأكيد مسح جميع البوتات*\n\nهل أنت متأكد من مسح جميع البوتات في النظام؟\n\n❗ سيتم حذف جميع البوتات لجميع المستخدمين نهائياً!',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: clearAllKeyboard
                    }
                );
                break;

            case 'admin_confirm_clear_all':
                await this.clearAllBots(chatId, userId);
                break;

            case 'admin_cleanup_db':
                const cleanupKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ نعم، نظف قاعدة البيانات', callback_data: 'admin_confirm_cleanup' },
                            { text: '❌ إلغاء', callback_data: 'admin_panel' }
                        ]
                    ]
                };

                await this.bot.sendMessage(chatId,
                    '⚠️ *تأكيد تنظيف قاعدة البيانات*\n\nسيتم:\n• مسح جميع البوتات المتوقفة\n• مسح الإحصائيات القديمة\n• تنظيف البيانات المؤقتة\n\n❗ هذا الإجراء لا يمكن التراجع عنه!',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: cleanupKeyboard
                    }
                );
                break;

            case 'admin_confirm_cleanup':
                await this.cleanupDatabase(chatId, userId);
                break;
        }
    }

    async handleAllUsers(chatId, userId) {
        try {
            const users = await this.db.getAllUsers();

            let message = '👥 *قائمة المستخدمين:*\n\n';

            if (users.length === 0) {
                message += 'لا يوجد مستخدمون مسجلون';
            } else {
                users.forEach((user, index) => {
                    message += `${index + 1}. **${user.username || 'غير محدد'}** (ID: ${user.telegram_id})\n`;
                    message += `   📅 تاريخ التسجيل: ${new Date(user.created_at).toLocaleDateString('ar')}\n\n`;
                });
            }

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 العودة للوحة الإدارة', callback_data: 'admin_panel' }]
                ]
            };

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            await this.bot.sendMessage(chatId, '❌ خطأ في جلب قائمة المستخدمين');
        }
    }

    async sendBroadcastMessage(chatId, userId, message) {
        try {
            const users = await this.db.getAllUsers();

            if (users.length === 0) {
                await this.bot.sendMessage(chatId, '❌ لا يوجد مستخدمون لإرسال الرسالة إليهم');
                this.userStates.delete(userId);
                return;
            }

            await this.bot.sendMessage(chatId, `🔄 جاري إرسال الرسالة إلى ${users.length} مستخدم...`);

            let successCount = 0;
            let failCount = 0;

            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.telegram_id,
                        `📢 *رسالة من إدارة النظام:*\n\n${message}`,
                        { parse_mode: 'Markdown' }
                    );
                    successCount++;
                } catch (error) {
                    failCount++;
                    console.error(`فشل في إرسال الرسالة للمستخدم ${user.telegram_id}:`, error.message);
                }

                // تأخير بسيط لتجنب حدود التلغرام
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            await this.bot.sendMessage(chatId,
                `✅ *تم إرسال الرسالة الجماعية*\n\n` +
                `📤 تم الإرسال بنجاح: ${successCount}\n` +
                `❌ فشل الإرسال: ${failCount}\n` +
                `📊 المجموع: ${users.length}`,
                { parse_mode: 'Markdown' }
            );

            this.userStates.delete(userId);

        } catch (error) {
            console.error('خطأ في الإرسال الجماعي:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في الإرسال الجماعي');
            this.userStates.delete(userId);
        }
    }

    async handleAllBotsAdmin(chatId, userId) {
        try {
            const allBots = await this.db.getAllBots();

            let message = '🤖 *قائمة جميع البوتات:*\n\n';

            if (allBots.length === 0) {
                message += 'لا توجد بوتات مسجلة';
            } else {
                allBots.forEach((bot, index) => {
                    const statusEmoji = bot.status === 'running' ? '🟢' :
                                      bot.status === 'stopped' ? '🔴' : '🟡';

                    message += `${index + 1}. ${statusEmoji} **${bot.bot_name}**\n`;
                    message += `   🌐 ${bot.host}:${bot.port}\n`;
                    message += `   🎮 ${bot.edition === 'java' ? 'Java' : 'Bedrock'} ${bot.version}\n`;
                    message += `   👤 المالك: ${bot.user_id}\n\n`;
                });
            }

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 العودة للوحة الإدارة', callback_data: 'admin_panel' }]
                ]
            };

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            await this.bot.sendMessage(chatId, '❌ خطأ في جلب قائمة البوتات');
        }
    }

    async handleSystemStats(chatId, userId) {
        try {
            const users = await this.db.getAllUsers();
            const bots = await this.db.getAllBots();
            const activeBots = this.botManager.getActiveBots();

            const runningBots = bots.filter(bot => bot.status === 'running').length;
            const stoppedBots = bots.filter(bot => bot.status === 'stopped').length;
            const errorBots = bots.filter(bot => bot.status === 'error').length;

            const javaBotsCount = bots.filter(bot => bot.edition === 'java').length;
            const bedrockBotsCount = bots.filter(bot => bot.edition === 'bedrock').length;

            let message = '📊 *إحصائيات النظام*\n\n';

            message += '👥 **المستخدمون:**\n';
            message += `   📈 العدد الكلي: ${users.length}\n\n`;

            message += '🤖 **البوتات:**\n';
            message += `   📈 العدد الكلي: ${bots.length}\n`;
            message += `   🟢 يعمل: ${runningBots}\n`;
            message += `   🔴 متوقف: ${stoppedBots}\n`;
            message += `   🟡 خطأ: ${errorBots}\n\n`;

            message += '🎮 **حسب النوع:**\n';
            message += `   ☕ Java: ${javaBotsCount}\n`;
            message += `   🪨 Bedrock: ${bedrockBotsCount}\n\n`;

            message += '⚡ **الذاكرة:**\n';
            message += `   🔄 البوتات النشطة في الذاكرة: ${activeBots.size}\n`;

            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            message += `   ⏱️ وقت التشغيل: ${hours}س ${minutes}د\n`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔙 العودة للوحة الإدارة', callback_data: 'admin_panel' }]
                ]
            };

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            await this.bot.sendMessage(chatId, '❌ خطأ في جلب الإحصائيات');
        }
    }

    async handleUserClearAllBots(chatId, userId) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                return;
            }

            const userBots = await this.db.getUserBots(user.id);

            if (userBots.length === 0) {
                await this.bot.sendMessage(chatId, '❌ لا توجد بوتات لحذفها');
                return;
            }

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ نعم، امسح جميع بوتاتي', callback_data: 'user_confirm_clear_all' },
                        { text: '❌ إلغاء', callback_data: 'my_bots' }
                    ]
                ]
            };

            await this.bot.sendMessage(chatId,
                `⚠️ *تأكيد مسح جميع البوتات*\n\nلديك ${userBots.length} بوت(ات)\n\nهل أنت متأكد من حذف جميع بوتاتك؟\n\n❗ هذا الإجراء لا يمكن التراجع عنه!`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                }
            );

        } catch (error) {
            await this.bot.sendMessage(chatId, '❌ حدث خطأ');
        }
    }

    async clearUserBots(chatId, userId) {
        try {
            const user = await this.db.getUser(userId);
            if (!user) {
                await this.bot.sendMessage(chatId, '❌ خطأ في النظام');
                return;
            }

            await this.bot.sendMessage(chatId, '🔄 جاري مسح جميع بوتاتك...');

            // الحصول على بوتات المستخدم
            const userBots = await this.db.getUserBots(user.id);

            // إيقاف البوتات النشطة للمستخدم
            for (const bot of userBots) {
                if (this.botManager.getActiveBots().has(bot.id)) {
                    await this.botManager.stopBot(bot.id);
                }
            }

            // حذف جميع بوتات المستخدم
            const result = await this.db.clearUserBots(user.id);

            if (result) {
                await this.bot.sendMessage(chatId,
                    `✅ *تم مسح جميع بوتاتك بنجاح!*\n\n` +
                    `🗑️ تم حذف ${userBots.length} بوت\n` +
                    `⏹️ تم إيقاف البوتات النشطة`,
                    { parse_mode: 'Markdown' }
                );

                // العودة للقائمة الرئيسية
                await this.handleStart({ chat: { id: chatId }, from: { id: userId } });
            } else {
                await this.bot.sendMessage(chatId, '❌ فشل في مسح البوتات');
            }

        } catch (error) {
            console.error('خطأ في مسح بوتات المستخدم:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في مسح البوتات');
        }
    }

    async clearAllBots(chatId, userId) {
        try {
            await this.bot.sendMessage(chatId, '🔄 جاري مسح جميع البوتات...');

            // إيقاف جميع البوتات النشطة
            await this.botManager.shutdown();

            // مسح جميع البوتات من قاعدة البيانات
            const result = await this.db.clearAllBots();

            if (result) {
                await this.bot.sendMessage(chatId,
                    '✅ *تم مسح جميع البوتات بنجاح!*\n\n' +
                    '🗑️ تم حذف جميع البوتات من النظام\n' +
                    '⏹️ تم إيقاف جميع البوتات النشطة',
                    { parse_mode: 'Markdown' }
                );
            } else {
                await this.bot.sendMessage(chatId, '❌ فشل في مسح البوتات');
            }

        } catch (error) {
            console.error('خطأ في مسح جميع البوتات:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في مسح البوتات');
        }
    }

    async cleanupDatabase(chatId, userId) {
        try {
            await this.bot.sendMessage(chatId, '🔄 جاري تنظيف قاعدة البيانات...');

            const result = await this.db.cleanupDatabase();

            await this.bot.sendMessage(chatId,
                '✅ *تم تنظيف قاعدة البيانات بنجاح!*\n\n' +
                `🗑️ تم حذف ${result.deletedBots} بوت متوقف\n` +
                `📊 تم حذف ${result.deletedStats} إحصائية قديمة\n` +
                `🧹 تم تنظيف البيانات المؤقتة`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('خطأ في تنظيف قاعدة البيانات:', error);
            await this.bot.sendMessage(chatId, '❌ حدث خطأ في تنظيف قاعدة البيانات');
        }
    }

    async handleBroadcast(msg, message) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!this.adminIds.includes(userId)) {
            await this.bot.sendMessage(chatId, '❌ ليس لديك صلاحية للوصول لهذا الأمر');
            return;
        }

        // هنا يمكن إضافة كود الإرسال الجماعي
        await this.bot.sendMessage(chatId, `📢 تم إرسال الرسالة: "${message}" (قيد التطوير)`);
    }

    async handleClearMyBotsCommand(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        await this.handleUserClearAllBots(chatId, userId);
    }

    async handleClearAllBotsCommand(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!this.adminIds.includes(userId)) {
            await this.bot.sendMessage(chatId, '❌ ليس لديك صلاحية للوصول لهذا الأمر');
            return;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ نعم، امسح جميع البوتات', callback_data: 'admin_confirm_clear_all' },
                    { text: '❌ إلغاء', callback_data: 'admin_panel' }
                ]
            ]
        };

        await this.bot.sendMessage(chatId,
            '⚠️ *تأكيد مسح جميع البوتات*\n\nهل أنت متأكد من مسح جميع البوتات في النظام؟\n\n❗ سيتم حذف جميع البوتات لجميع المستخدمين نهائياً!',
            {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }
        );
    }

    // إيقاف البوت
    async shutdown() {
        console.log('🔄 إيقاف بوت التلغرام...');
        try {
            if (this.botManager) {
                await this.botManager.shutdown();
            }
            if (this.bot) {
                this.bot.stopPolling();
            }
            console.log('✅ تم إيقاف بوت التلغرام بنجاح');
        } catch (error) {
            console.error('خطأ في إيقاف بوت التلغرام:', error.message);
        }
    }
}

module.exports = MinecraftTelegramBot;
