-- 用户不再保存默认生图后端偏好；所有未显式指定分组的请求均使用平台默认分组。
DROP TABLE IF EXISTS "user_image_backend_preference";
