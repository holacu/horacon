// إعدادات النظام
const config = {
    // إعدادات بوت التلغرام
    telegram: {
        // توكن البوت - يجب تغييره في index.js
        token: process.env.TELEGRAM_BOT_TOKEN || '8147667148:AAEq8lfdIV42sOFwf3Cdf9ZYpinm3pUgkZU',
        
        // إعدادات الرسائل
        messages: {
            maxLength: 4096, // الحد الأقصى لطول الرسالة في التلغرام
            parseMode: 'Markdown'
        },
        
        // إعدادات الأمان
        security: {
            rateLimitWindow: 60000, // نافزة زمنية للحد من الطلبات (بالميلي ثانية)
            maxRequestsPerWindow: 30, // عدد الطلبات المسموحة في النافزة الزمنية
            adminOnly: false // هل النظام مقتصر على الأدمن فقط
        }
    },

    // إعدادات البوتات
    bots: {
        // الحد الأقصى لعدد البوتات لكل مستخدم
        maxBotsPerUser: 3,
        
        // إعدادات إعادة الاتصال
        reconnection: {
            maxAttempts: 5, // عدد محاولات إعادة الاتصال
            delay: 5000, // التأخير بين المحاولات (بالميلي ثانية)
            backoffMultiplier: 1.5 // مضاعف التأخير مع كل محاولة
        },
        
        // مهلة الاتصال
        timeout: {
            connection: 30000, // مهلة الاتصال (30 ثانية)
            keepAlive: 30000, // فترة keep-alive
            response: 10000 // مهلة انتظار الاستجابة
        },
        
        // إعدادات الأداء
        performance: {
            maxMemoryUsage: 512 * 1024 * 1024, // 512 MB
            gcInterval: 300000, // فترة تنظيف الذاكرة (5 دقائق)
            statsUpdateInterval: 60000 // فترة تحديث الإحصائيات (دقيقة)
        }
    },

    // الإصدارات المدعومة
    supportedVersions: {
        java: [
            '1.21.1',
            '1.21.0',
            '1.20.6',
            '1.20.4',
            '1.20.1'
        ],
        bedrock: [
            '1.21.93',
            '1.21.90',
            '1.21.80',
            '1.21.70',
            '1.21.60'
        ]
    },

    // إعدادات قاعدة البيانات
    database: {
        // مسار ملف قاعدة البيانات
        path: './minecraft_bot.db',
        
        // إعدادات النسخ الاحتياطي
        backup: {
            enabled: true,
            interval: 24 * 60 * 60 * 1000, // كل 24 ساعة
            maxBackups: 7, // الاحتفاظ بـ 7 نسخ احتياطية
            path: './backups/'
        },
        
        // إعدادات التحسين
        optimization: {
            vacuumInterval: 7 * 24 * 60 * 60 * 1000, // أسبوع
            analyzeInterval: 24 * 60 * 60 * 1000, // يوم
            checkpointInterval: 60 * 60 * 1000 // ساعة
        }
    },

    // إعدادات السجلات
    logging: {
        // مستوى السجلات
        level: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
        
        // حفظ السجلات في ملفات
        file: {
            enabled: true,
            path: './logs/',
            maxSize: 10 * 1024 * 1024, // 10 MB
            maxFiles: 5,
            datePattern: 'YYYY-MM-DD'
        },
        
        // إعدادات سجلات البوتات
        bots: {
            logChat: true, // تسجيل رسائل الشات
            logCommands: true, // تسجيل الأوامر
            logConnections: true, // تسجيل الاتصالات
            logErrors: true // تسجيل الأخطاء
        }
    },

    // إعدادات الأمان
    security: {
        // تشفير البيانات الحساسة
        encryption: {
            enabled: false, // يمكن تفعيله لاحقاً
            algorithm: 'aes-256-gcm',
            keyLength: 32
        },
        
        // حماية من الهجمات
        protection: {
            maxFailedAttempts: 5, // عدد المحاولات الفاشلة المسموحة
            lockoutDuration: 15 * 60 * 1000, // مدة الحظر (15 دقيقة)
            ipWhitelist: [], // قائمة IP المسموحة
            ipBlacklist: [] // قائمة IP المحظورة
        }
    },

    // إعدادات الشبكة
    network: {
        // إعدادات البروكسي (اختياري)
        proxy: {
            enabled: false,
            host: '',
            port: 0,
            username: '',
            password: ''
        },
        
        // إعدادات DNS
        dns: {
            timeout: 5000,
            retries: 3,
            servers: ['8.8.8.8', '1.1.1.1']
        }
    },

    // إعدادات المراقبة
    monitoring: {
        // مراقبة الأداء
        performance: {
            enabled: true,
            interval: 60000, // دقيقة
            metrics: ['cpu', 'memory', 'connections', 'errors']
        },
        
        // التنبيهات
        alerts: {
            enabled: true,
            thresholds: {
                memoryUsage: 80, // نسبة مئوية
                errorRate: 10, // أخطاء في الدقيقة
                connectionFailures: 5 // فشل اتصال متتالي
            }
        }
    },

    // إعدادات التطوير
    development: {
        // وضع التطوير
        debug: process.env.NODE_ENV === 'development',
        
        // إعادة التحميل التلقائي
        hotReload: false,
        
        // اختبار الاتصالات
        testMode: false,
        
        // محاكاة الأخطاء
        simulateErrors: false
    },

    // إعدادات الإنتاج
    production: {
        // تحسينات الأداء
        optimizations: {
            enableGzip: true,
            minifyResponses: true,
            cacheStatic: true
        },
        
        // إعدادات الكلاستر
        cluster: {
            enabled: false,
            workers: require('os').cpus().length
        }
    },

    // رسائل النظام
    messages: {
        // رسائل الترحيب
        welcome: {
            ar: '🎮 مرحباً بك في بوت ماينكرافت المتقدم!',
            en: '🎮 Welcome to Advanced Minecraft Bot!'
        },
        
        // رسائل الأخطاء
        errors: {
            general: 'حدث خطأ، يرجى المحاولة مرة أخرى',
            connection: 'فشل في الاتصال بالسيرفر',
            permission: 'ليس لديك صلاحية لهذا الإجراء',
            notFound: 'العنصر المطلوب غير موجود',
            rateLimit: 'تم تجاوز الحد المسموح من الطلبات'
        },
        
        // رسائل النجاح
        success: {
            botCreated: 'تم إنشاء البوت بنجاح!',
            botStarted: 'تم تشغيل البوت بنجاح!',
            botStopped: 'تم إيقاف البوت بنجاح!',
            messageSent: 'تم إرسال الرسالة بنجاح!',
            commandExecuted: 'تم تنفيذ الأمر بنجاح!'
        }
    }
};

// دالة للحصول على إعداد معين
function getConfig(path) {
    return path.split('.').reduce((obj, key) => obj && obj[key], config);
}

// دالة لتحديث إعداد معين
function setConfig(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, config);
    target[lastKey] = value;
}

// دالة للتحقق من صحة الإعدادات
function validateConfig() {
    const errors = [];
    
    // التحقق من التوكن
    if (!config.telegram.token || config.telegram.token === 'YOUR_BOT_TOKEN_HERE') {
        errors.push('توكن بوت التلغرام غير صحيح');
    }
    
    // التحقق من الإصدارات المدعومة
    if (!config.supportedVersions.java.length || !config.supportedVersions.bedrock.length) {
        errors.push('قائمة الإصدارات المدعومة فارغة');
    }
    
    // التحقق من إعدادات قاعدة البيانات
    if (!config.database.path) {
        errors.push('مسار قاعدة البيانات غير محدد');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    config,
    getConfig,
    setConfig,
    validateConfig
};
