const MinecraftTelegramBot = require('./telegram-bot');

// توكن بوت التلغرام
const TELEGRAM_BOT_TOKEN = '8147667148:AAEq8lfdIV42sOFwf3Cdf9ZYpinm3pUgkZU';

// معرفات الأدمن (يمكن إضافة المزيد)
const ADMIN_IDS = [
    // أضف معرف التلغرام الخاص بك هنا
    // مثال: 123456789
];

class MinecraftBotSystem {
    constructor() {
        this.telegramBot = null;
        this.isRunning = false;
    }

    async start() {
        try {
            console.log('🚀 بدء تشغيل نظام بوت ماينكرافت...');
            
            // التحقق من وجود التوكن
            if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
                throw new Error('❌ يرجى إضافة توكن بوت التلغرام في ملف index.js');
            }

            // إنشاء بوت التلغرام
            this.telegramBot = new MinecraftTelegramBot(TELEGRAM_BOT_TOKEN);

            // انتظار تهيئة البوت
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // إضافة الأدمن
            for (const adminId of ADMIN_IDS) {
                await this.telegramBot.addAdmin(adminId);
            }

            // تحميل الأدمن من قاعدة البيانات
            await this.telegramBot.loadAdmins();

            this.isRunning = true;
            
            console.log('✅ تم تشغيل النظام بنجاح!');
            console.log('📱 بوت التلغرام جاهز للاستخدام');
            console.log('🎮 يمكن الآن إنشاء بوتات ماينكرافت Java و Bedrock');
            console.log('');
            console.log('📋 الميزات المتاحة:');
            console.log('   • إنشاء بوتات ماينكرافت (Java & Bedrock)');
            console.log('   • دعم آخر 5 إصدارات لكل نوع');
            console.log('   • التحكم الكامل في البوتات (تشغيل/إيقاف)');
            console.log('   • إرسال الرسائل والأوامر');
            console.log('   • مراقبة الإحصائيات');
            console.log('   • واجهة إدارة للأدمن');
            console.log('   • دعم سيرفرات Aternos وغيرها');
            console.log('');
            console.log('🔧 للحصول على المساعدة، استخدم الأمر /help في بوت التلغرام');

        } catch (error) {
            console.error('❌ خطأ في تشغيل النظام:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        if (this.isRunning && this.telegramBot) {
            console.log('🔄 إيقاف النظام...');
            await this.telegramBot.shutdown();
            this.isRunning = false;
            console.log('✅ تم إيقاف النظام بنجاح');
        }
    }

    // معالجة إشارات النظام للإيقاف الآمن
    setupGracefulShutdown() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        
        signals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`\n📡 تم استقبال إشارة ${signal}`);
                await this.stop();
                process.exit(0);
            });
        });

        // معالجة الأخطاء غير المتوقعة
        process.on('uncaughtException', async (error) => {
            console.error('❌ خطأ غير متوقع:', error);
            await this.stop();
            process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            // تجاهل أخطاء Telegram العادية
            if (reason && reason.code === 'ETELEGRAM') {
                console.log('تجاهل خطأ Telegram:', reason.message);
                return;
            }

            console.error('❌ Promise مرفوض:', reason);
            await this.stop();
            process.exit(1);
        });
    }
}

// إنشاء وتشغيل النظام
const system = new MinecraftBotSystem();

// إعداد الإيقاف الآمن
system.setupGracefulShutdown();

// بدء التشغيل
system.start().catch(error => {
    console.error('❌ فشل في تشغيل النظام:', error);
    process.exit(1);
});

// تصدير النظام للاستخدام الخارجي
module.exports = MinecraftBotSystem;
