const MinecraftJavaBot = require('./minecraft-java-bot');
const MinecraftBedrockBot = require('./minecraft-bedrock-bot');
const Database = require('./database');
const { EventEmitter } = require('events');

class BotManager extends EventEmitter {
    constructor() {
        super();
        this.db = null;
        this.activeBots = new Map(); // botId -> bot instance
        this.supportedVersions = {
            java: ['1.21.1', '1.21.0', '1.20.6', '1.20.4', '1.20.1'],
            bedrock: ['1.21.93', '1.21.90', '1.21.80', '1.21.70', '1.21.60']
        };
        this.initialized = false;
        this.serverMonitor = new Map(); // مراقبة السيرفرات
        this.disconnectionAlerts = new Map(); // عداد إشعارات الانقطاع
        this.manuallyStoppedBots = new Set(); // البوتات التي تم إيقافها يدوياً
        this.monitoringInterval = null; // فترة المراقبة
    }

    async init() {
        if (!this.initialized) {
            this.db = await new Database().init();
            this.initialized = true;
            this.startServerMonitoring(); // بدء مراقبة السيرفرات
        }
        return this;
    }

    // بدء مراقبة السيرفرات
    startServerMonitoring() {
        // مراقبة كل 30 ثانية
        this.monitoringInterval = setInterval(async () => {
            await this.checkAllServers();
        }, 30000);

        console.log('🔍 تم بدء مراقبة السيرفرات');
    }

    // إيقاف مراقبة السيرفرات
    stopServerMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            console.log('⏹️ تم إيقاف مراقبة السيرفرات');
        }
    }

    // فحص جميع السيرفرات
    async checkAllServers() {
        try {
            for (const [botId, bot] of this.activeBots) {
                await this.checkBotConnection(botId, bot);
            }
        } catch (error) {
            console.error('خطأ في فحص السيرفرات:', error);
        }
    }

    // فحص اتصال بوت معين
    async checkBotConnection(botId, bot) {
        try {
            const isConnected = bot && bot.isAlive();
            const botData = await this.db.getBot(botId);

            if (!botData) return;

            // إذا كان البوت منقطع
            if (!isConnected) {
                await this.handleBotDisconnection(botId, botData);
            } else {
                // إعادة تعيين عداد الإشعارات عند الاتصال
                if (this.disconnectionAlerts.has(botId)) {
                    console.log(`✅ البوت ${botData.bot_name} عاد للاتصال - إعادة تعيين العداد`);
                    this.disconnectionAlerts.delete(botId);
                }
            }
        } catch (error) {
            console.error(`خطأ في فحص البوت ${botId}:`, error);
        }
    }

    // معالجة انقطاع البوت
    async handleBotDisconnection(botId, botData) {
        // تجاهل البوتات التي تم إيقافها يدوياً
        if (this.manuallyStoppedBots.has(botId)) {
            console.log(`🛑 تجاهل انقطاع البوت ${botData.bot_name} - تم إيقافه يدوياً`);
            return;
        }

        const alertCount = this.disconnectionAlerts.get(botId) || 0;

        // منع المعالجة المكررة
        if (alertCount >= 6) {
            return; // البوت تم إيقافه بالفعل
        }

        console.log(`⚠️ معالجة انقطاع البوت ${botData.bot_name} - العداد: ${alertCount + 1}/5`);

        if (alertCount < 5) {
            // زيادة عداد الإشعارات
            this.disconnectionAlerts.set(botId, alertCount + 1);

            // إرسال إشعار انقطاع (بدون رسالة كونسول مكررة)
            this.emit('serverDown', {
                botId: botId,
                botName: botData.bot_name,
                host: botData.server_host,
                port: botData.server_port,
                alertCount: alertCount + 1,
                userId: botData.user_id
            });

        } else if (alertCount === 5) {
            // إرسال إشعار نهائي وإيقاف البوت (مرة واحدة فقط)
            console.log(`🛑 إيقاف البوت ${botData.bot_name} نهائياً بعد 5 إشعارات`);

            // تعيين العداد إلى 6 لمنع المعالجة المكررة
            this.disconnectionAlerts.set(botId, 6);

            this.emit('serverDownFinal', {
                botId: botId,
                botName: botData.bot_name,
                host: botData.server_host,
                port: botData.server_port,
                userId: botData.user_id
            });

            // إيقاف البوت نهائياً وإزالته من النظام
            await this.forceStopBot(botId);
        }
    }

    // إنشاء بوت جديد
    async createBot(userId, botConfig) {
        try {
            // التحقق من صحة الإعدادات
            const validation = this.validateBotConfig(botConfig);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // التحقق من عدد البوتات المسموح للمستخدم
            const userBots = await this.db.getUserBots(userId);
            const maxBots = parseInt(await this.db.getSetting('max_bots_per_user')) || 3;
            
            if (userBots.length >= maxBots) {
                throw new Error(`لا يمكنك إنشاء أكثر من ${maxBots} بوتات`);
            }

            // إنشاء البوت في قاعدة البيانات
            const botId = await this.db.createBot(
                userId,
                botConfig.name,
                botConfig.host,
                botConfig.port,
                botConfig.version,
                botConfig.edition
            );

            console.log(`✅ تم إنشاء البوت بنجاح - ID: ${botId}`);
            return { success: true, botId, message: 'تم إنشاء البوت بنجاح' };

        } catch (error) {
            console.error(`❌ خطأ في إنشاء البوت: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // بدء تشغيل البوت
    async startBot(botId) {
        try {
            // التحقق من وجود البوت في قاعدة البيانات
            const botData = await this.db.getBot(botId);
            if (!botData) {
                throw new Error('البوت غير موجود');
            }

            // التحقق من أن البوت ليس يعمل بالفعل
            if (this.activeBots.has(botId)) {
                throw new Error('البوت يعمل بالفعل');
            }

            // إزالة البوت من قائمة الإيقاف اليدوي (إذا كان موجوداً)
            if (this.manuallyStoppedBots.has(botId)) {
                this.manuallyStoppedBots.delete(botId);
                console.log(`🔄 إزالة البوت ${botId} من قائمة الإيقاف اليدوي`);
            }

            // إنشاء instance البوت
            const botConfig = {
                host: botData.server_host,
                port: botData.server_port,
                username: botData.bot_name,
                version: botData.minecraft_version
            };

            let bot;
            if (botData.edition === 'java') {
                bot = new MinecraftJavaBot(botConfig);
            } else if (botData.edition === 'bedrock') {
                bot = new MinecraftBedrockBot(botConfig);
            } else {
                throw new Error('نوع البوت غير مدعوم');
            }

            // إعداد مستمعي الأحداث
            this.setupBotEventListeners(bot, botId, botData);

            // بدء الاتصال
            await bot.connect();

            // حفظ البوت في الذاكرة
            this.activeBots.set(botId, bot);

            // تحديث حالة البوت في قاعدة البيانات
            await this.db.updateBotStatus(botId, 'running');

            console.log(`🚀 تم بدء تشغيل البوت ${botData.bot_name} بنجاح`);
            return { success: true, message: 'تم بدء تشغيل البوت بنجاح' };

        } catch (error) {
            console.error(`❌ خطأ في بدء تشغيل البوت: ${error.message}`);
            await this.db.updateBotStatus(botId, 'error');
            return { success: false, error: error.message };
        }
    }

    // إيقاف البوت
    async stopBot(botId) {
        try {
            const bot = this.activeBots.get(botId);
            if (!bot) {
                throw new Error('البوت غير نشط');
            }

            // تسجيل أن هذا البوت تم إيقافه يدوياً
            this.manuallyStoppedBots.add(botId);
            console.log(`🛑 تسجيل الإيقاف اليدوي للبوت ${botId}`);

            // إيقاف محاولات إعادة الاتصال
            if (bot.stopReconnecting) {
                bot.stopReconnecting();
            }

            // قطع الاتصال
            bot.disconnect();

            // إزالة البوت من الذاكرة
            this.activeBots.delete(botId);

            // تحديث حالة البوت في قاعدة البيانات
            await this.db.updateBotStatus(botId, 'stopped');

            console.log(`⏹️ تم إيقاف البوت ${botId} بنجاح`);
            return { success: true, message: 'تم إيقاف البوت بنجاح' };

        } catch (error) {
            console.error(`❌ خطأ في إيقاف البوت: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // إيقاف البوت نهائياً (بعد فقدان الاتصال بالسيرفر)
    async forceStopBot(botId) {
        try {
            const bot = this.activeBots.get(botId);
            if (bot) {
                console.log(`🛑 إيقاف البوت ${botId} نهائياً - فقدان الاتصال بالسيرفر`);

                // إيقاف جميع محاولات إعادة الاتصال
                if (bot.stopReconnecting) {
                    bot.stopReconnecting();
                }

                // قطع الاتصال فوراً
                try {
                    if (bot.forceDisconnect) {
                        bot.forceDisconnect();
                    } else {
                        bot.disconnect();
                    }
                } catch (disconnectError) {
                    console.log(`تجاهل خطأ قطع الاتصال: ${disconnectError.message}`);
                }

                // إزالة البوت من القائمة النشطة
                this.activeBots.delete(botId);

                console.log(`🔌 قطع الاتصال مع البوت ${botId} نهائياً`);
            }

            // تحديث حالة البوت في قاعدة البيانات إلى 'stopped' (حالة صحيحة)
            try {
                await this.db.updateBotStatus(botId, 'stopped');
                console.log(`✅ تم تحديث حالة البوت ${botId} إلى 'stopped'`);
            } catch (dbError) {
                console.error(`خطأ في تحديث قاعدة البيانات للبوت ${botId}:`, dbError.message);
                // لا نرمي الخطأ هنا لأن الإيقاف نجح
            }

            // إزالة البوت من عداد الإشعارات
            this.disconnectionAlerts.delete(botId);

            return { success: true };
        } catch (error) {
            console.error(`خطأ في الإيقاف النهائي للبوت ${botId}:`, error);
            return { success: false, error: error.message };
        }
    }

    // حذف البوت
    async deleteBot(botId, userId) {
        try {
            // التحقق من ملكية البوت
            const botData = await this.db.getBot(botId);
            if (!botData) {
                throw new Error('البوت غير موجود');
            }

            if (botData.user_id !== userId) {
                throw new Error('ليس لديك صلاحية لحذف هذا البوت');
            }

            // إيقاف البوت إذا كان يعمل
            if (this.activeBots.has(botId)) {
                await this.stopBot(botId);
            }

            // حذف البوت من قاعدة البيانات
            await this.db.deleteBot(botId);

            console.log(`🗑️ تم حذف البوت ${botId} بنجاح`);
            return { success: true, message: 'تم حذف البوت بنجاح' };

        } catch (error) {
            console.error(`❌ خطأ في حذف البوت: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // الحصول على معلومات البوت
    async getBotInfo(botId) {
        try {
            const botData = await this.db.getBot(botId);
            if (!botData) {
                throw new Error('البوت غير موجود');
            }

            const bot = this.activeBots.get(botId);
            const isActive = bot && bot.isAlive();

            let runtimeInfo = {
                connected: false,
                uptime: 0
            };

            if (isActive) {
                runtimeInfo = bot.getInfo();
            }

            return {
                success: true,
                data: {
                    id: botData.id,
                    name: botData.bot_name,
                    host: botData.server_host,
                    port: botData.server_port,
                    version: botData.minecraft_version,
                    edition: botData.edition,
                    status: botData.status,
                    createdAt: botData.created_at,
                    ...runtimeInfo
                }
            };

        } catch (error) {
            console.error(`❌ خطأ في الحصول على معلومات البوت: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // الحصول على بوتات المستخدم
    async getUserBots(userId) {
        try {
            const bots = await this.db.getUserBots(userId);
            
            const botsWithStatus = bots.map(bot => {
                const activeBot = this.activeBots.get(bot.id);
                const isActive = activeBot && activeBot.isAlive();
                
                return {
                    id: bot.id,
                    name: bot.bot_name,
                    host: bot.server_host,
                    port: bot.server_port,
                    version: bot.minecraft_version,
                    edition: bot.edition,
                    status: isActive ? 'running' : bot.status,
                    createdAt: bot.created_at
                };
            });

            return { success: true, data: botsWithStatus };

        } catch (error) {
            console.error(`❌ خطأ في الحصول على بوتات المستخدم: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // إرسال رسالة عبر البوت
    async sendMessage(botId, message) {
        try {
            const bot = this.activeBots.get(botId);
            if (!bot || !bot.isAlive()) {
                throw new Error('البوت غير متصل');
            }

            const success = bot.sendMessage(message);
            if (!success) {
                throw new Error('فشل في إرسال الرسالة');
            }

            return { success: true, message: 'تم إرسال الرسالة بنجاح' };

        } catch (error) {
            console.error(`❌ خطأ في إرسال الرسالة: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // تنفيذ أمر عبر البوت
    async executeCommand(botId, command) {
        try {
            const bot = this.activeBots.get(botId);
            if (!bot || !bot.isAlive()) {
                throw new Error('البوت غير متصل');
            }

            const success = bot.executeCommand(command);
            if (!success) {
                throw new Error('فشل في تنفيذ الأمر');
            }

            return { success: true, message: 'تم تنفيذ الأمر بنجاح' };

        } catch (error) {
            console.error(`❌ خطأ في تنفيذ الأمر: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // التحقق من صحة إعدادات البوت
    validateBotConfig(config) {
        if (!config.name || config.name.trim().length === 0) {
            return { valid: false, error: 'اسم البوت مطلوب' };
        }

        if (!config.host || config.host.trim().length === 0) {
            return { valid: false, error: 'عنوان السيرفر مطلوب' };
        }

        if (!config.port || isNaN(config.port) || config.port < 1 || config.port > 65535) {
            return { valid: false, error: 'رقم البورت غير صحيح' };
        }

        if (!config.edition || !['java', 'bedrock'].includes(config.edition)) {
            return { valid: false, error: 'نوع ماينكرافت غير صحيح' };
        }

        if (!config.version || !this.supportedVersions[config.edition].includes(config.version)) {
            return { valid: false, error: 'إصدار ماينكرافت غير مدعوم' };
        }

        return { valid: true };
    }

    // إعداد مستمعي أحداث البوت
    setupBotEventListeners(bot, botId, botData) {
        bot.on('connected', async (data) => {
            console.log(`✅ البوت ${botData.bot_name} متصل بنجاح`);
            await this.db.addBotStat(botId, new Date());

            // إعادة تعيين عداد الانقطاع عند الاتصال
            if (this.disconnectionAlerts.has(botId)) {
                console.log(`🔄 إعادة تعيين عداد الانقطاع للبوت ${botData.bot_name}`);
                this.disconnectionAlerts.delete(botId);
            }

            this.emit('botConnected', {
                botId,
                botName: botData.bot_name,
                shouldDeleteWarnings: true, // إشارة لحذف رسائل التحذير
                ...data
            });
        });

        bot.on('disconnected', async (data) => {
            console.log(`🔌 البوت ${botData.bot_name} انقطع الاتصال`);
            await this.db.updateBotStatus(botId, 'stopped');
            this.emit('botDisconnected', { botId, botName: botData.bot_name, ...data });

            // بدء عد الانقطاع فوراً
            await this.handleBotDisconnection(botId, botData);
        });

        bot.on('kicked', async (data) => {
            const reason = data.reason || 'سبب غير معروف';
            console.log(`👢 تم ركل البوت ${botData.bot_name}: ${reason}`);

            // تحديد ما إذا كان السبب يعني أن السيرفر مطفي
            const isServerDown = data.isServerDown !== undefined ? data.isServerDown : true;

            if (isServerDown) {
                console.log(`🔌 السيرفر ${botData.server_host}:${botData.server_port} مطفي أو غير متصل`);
                await this.handleBotDisconnection(botId, botData);
            } else {
                console.log(`⚠️ البوت ${botData.bot_name} تم ركله لسبب غير متعلق بالسيرفر: ${reason}`);
                // لا نبدأ عد الانقطاع لأن السيرفر شغال
            }
        });

        bot.on('error', async (error) => {
            console.error(`❌ خطأ في البوت ${botData.bot_name}: ${error.message}`);
            await this.db.updateBotStatus(botId, 'error');
            await this.db.addBotStat(botId, new Date(), new Date(), error.message);
            this.emit('botError', { botId, botName: botData.bot_name, error: error.message });
        });

        bot.on('reconnectFailed', async () => {
            console.log(`❌ فشل في إعادة الاتصال للبوت ${botData.bot_name}`);
            await this.handleBotDisconnection(botId, botData);
        });

        bot.on('chat', (data) => {
            this.emit('botChat', { botId, botName: botData.bot_name, ...data });
        });
    }

    // تحديث اسم البوت
    async updateBotName(botId, newName) {
        try {
            // التحقق من وجود البوت
            const botData = await this.db.getBot(botId);
            if (!botData) {
                return { success: false, error: 'البوت غير موجود' };
            }

            // إيقاف البوت إذا كان يعمل
            const wasRunning = this.activeBots.has(botId);
            if (wasRunning) {
                await this.stopBot(botId);
            }

            // تحديث الاسم في قاعدة البيانات
            const updateResult = await this.db.updateBotName(botId, newName);
            if (!updateResult) {
                return { success: false, error: 'فشل في تحديث الاسم في قاعدة البيانات' };
            }

            // إعادة تشغيل البوت بالاسم الجديد إذا كان يعمل
            if (wasRunning) {
                await this.startBot(botId);
            }

            return { success: true, message: 'تم تحديث اسم البوت بنجاح' };
        } catch (error) {
            console.error('خطأ في تحديث اسم البوت:', error);
            return { success: false, error: error.message };
        }
    }

    // الحصول على الإحصائيات العامة
    async getGeneralStats() {
        try {
            const stats = await this.db.getGeneralStats();
            stats.activeBotsCount = this.activeBots.size;
            return { success: true, data: stats };
        } catch (error) {
            console.error(`❌ خطأ في الحصول على الإحصائيات: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // الحصول على الإصدارات المدعومة
    getSupportedVersions() {
        return this.supportedVersions;
    }

    // الحصول على البوتات النشطة
    getActiveBots() {
        return this.activeBots;
    }

    // إغلاق جميع البوتات
    async shutdown() {
        console.log('🔄 إيقاف جميع البوتات...');
        
        for (const [botId, bot] of this.activeBots) {
            try {
                bot.disconnect();
                await this.db.updateBotStatus(botId, 'stopped');
            } catch (error) {
                console.error(`خطأ في إيقاف البوت ${botId}: ${error.message}`);
            }
        }

        this.activeBots.clear();
        this.db.close();
        console.log('✅ تم إيقاف جميع البوتات بنجاح');
    }
}

module.exports = BotManager;
