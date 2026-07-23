#!/usr/bin/env bash
# 部署 dotenv 单行读取器的回归测试。
# 使用方：生产部署质量门。
# 覆盖引号兼容、非法引号拒绝与不执行配置内容。

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
reader_path="${script_dir}/read-env-value.sh"
test_dir="$(mktemp -d)"

# 删除本测试创建的临时配置与输出。
# 不接触真实部署环境文件。
cleanup_test_files() {
  rm -rf "${test_dir}"
}
trap cleanup_test_files EXIT

# 断言读取器成功返回指定值。
# 失败时输出用例名称与实际值。
assert_value() {
  case_name="$1"
  env_file="$2"
  key="$3"
  expected="$4"
  actual="$(bash "${reader_path}" "${env_file}" "${key}")"
  if [ "${actual}" != "${expected}" ]; then
    printf '用例失败：%s\n期望：%s\n实际：%s\n' \
      "${case_name}" "${expected}" "${actual}" >&2
    return 1
  fi
}

# 断言非法 dotenv 引号只以预期错误拒绝。
# 同时防止脚本缺失、参数错误或意外标准输出造成假绿。
assert_rejected() {
  local case_name="$1"
  local env_file="$2"
  local key="$3"
  local expected_error="dotenv 键 ${key} 的引号不匹配。"
  local actual_error
  local status

  if bash "${reader_path}" "${env_file}" "${key}" \
    >"${test_dir}/rejected.out" 2>"${test_dir}/rejected.err"; then
    status=0
  else
    status="$?"
  fi
  if [ "${status}" -ne 1 ]; then
    printf '用例失败：%s 退出码应为 1，实际为 %s\n' \
      "${case_name}" "${status}" >&2
    return 1
  fi
  if [ -s "${test_dir}/rejected.out" ]; then
    printf '用例失败：%s 拒绝时不应输出值\n' "${case_name}" >&2
    return 1
  fi
  actual_error="$(<"${test_dir}/rejected.err")"
  if [ "${actual_error}" != "${expected_error}" ]; then
    printf '用例失败：%s\n期望错误：%s\n实际错误：%s\n' \
      "${case_name}" "${expected_error}" "${actual_error}" >&2
    return 1
  fi
}

valid_env="${test_dir}/valid.env"
age_recipient="age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
age_recipient+="qqqqqqqqqqqqqqqqqqqqqqqqqqq"
printf '%s\n' \
  'DATABASE_URL="postgresql://flux:secret@db:5432/flux?sslmode=require"' \
  "DEPLOY_BACKUP_S3_BUCKET='fluxmedia-production-backups'" \
  "DEPLOY_BACKUP_AGE_RECIPIENT=\"${age_recipient}\"" \
  'DEPLOY_BACKUP_S3_PREFIX=fluxmedia-production # 部署备份前缀' \
  >"${valid_env}"

assert_value \
  "双引号 DATABASE_URL" \
  "${valid_env}" \
  "DATABASE_URL" \
  "postgresql://flux:secret@db:5432/flux?sslmode=require"
assert_value \
  "单引号 bucket" \
  "${valid_env}" \
  "DEPLOY_BACKUP_S3_BUCKET" \
  "fluxmedia-production-backups"
assert_value \
  "双引号 age recipient" \
  "${valid_env}" \
  "DEPLOY_BACKUP_AGE_RECIPIENT" \
  "${age_recipient}"
assert_value \
  "无引号行尾注释" \
  "${valid_env}" \
  "DEPLOY_BACKUP_S3_PREFIX" \
  "fluxmedia-production"

literal_marker="${test_dir}/dotenv-content-was-executed"
literal_env="${test_dir}/literal.env"
printf 'DATABASE_URL="$(touch %s)"\n' "${literal_marker}" >"${literal_env}"
assert_value \
  "配置内容保持字面量" \
  "${literal_env}" \
  "DATABASE_URL" \
  "\$(touch ${literal_marker})"
if [ -e "${literal_marker}" ]; then
  printf '用例失败：读取器执行了 dotenv 内容\n' >&2
  exit 1
fi

unmatched_open_env="${test_dir}/unmatched-open.env"
printf '%s\n' 'DATABASE_URL="postgresql://db/flux' >"${unmatched_open_env}"
assert_rejected \
  "缺少双引号结尾" \
  "${unmatched_open_env}" \
  "DATABASE_URL"

unmatched_close_env="${test_dir}/unmatched-close.env"
printf '%s\n' "DEPLOY_BACKUP_S3_BUCKET=fluxmedia-backups'" \
  >"${unmatched_close_env}"
assert_rejected \
  "缺少单引号开头" \
  "${unmatched_close_env}" \
  "DEPLOY_BACKUP_S3_BUCKET"

trailing_text_env="${test_dir}/trailing-text.env"
printf '%s\n' 'DATABASE_URL="postgresql://db/flux"junk"' \
  >"${trailing_text_env}"
assert_rejected \
  "闭合引号后存在非法文本" \
  "${trailing_text_env}" \
  "DATABASE_URL"

printf '部署 dotenv 读取器测试通过。\n'
