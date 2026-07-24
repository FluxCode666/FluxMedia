-- 用户不再允许配置自定义上游 API；所有图像请求统一使用平台后端。
DROP TABLE IF EXISTS "user_api_config";
