# 龙瀚 CRM 一键推 GitHub 脚本
# 在 crm-mvp 文件夹右键 → "在此处打开 PowerShell" → 粘贴下面整段

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host '工作目录:' (Get-Location) -ForegroundColor Cyan

# 1. 清理：删除之前残留的 .git
if (Test-Path '.git') {
  Write-Host '删除旧的 .git 重新初始化...' -ForegroundColor Yellow
  Remove-Item -Recurse -Force .git
}

# 2. 初始化 git
Write-Host 'git init...' -ForegroundColor Cyan
git init 2>&1 | Out-Null
git config core.autocrlf false
git config user.email 'yangxiaohao001@users.noreply.github.com'
git config user.name 'yangxiaohao001'

# 3. 添加文件
Write-Host 'git add .' -ForegroundColor Cyan
git add .

# 4. 提交
Write-Host 'git commit...' -ForegroundColor Cyan
git commit -m '首次部署：龙瀚 CRM 完整代码' 2>&1 | Out-Null

# 5. 询问仓库 URL（如果是首次）
$remote = git remote get-url origin 2>$null
if (-not $remote) {
  Write-Host ''
  Write-Host '请粘贴你的 GitHub 仓库地址（如 https://github.com/yangxiaohao001/longhan-crm.git）：' -ForegroundColor Green
  $repoUrl = Read-Host
  if (-not $repoUrl) { $repoUrl = 'https://github.com/yangxiaohao001/longhan-crm.git' }
  git remote add origin $repoUrl
  $remote = $repoUrl
}

# 6. 推送到 main
Write-Host 'git push -u origin main ...' -ForegroundColor Cyan
git branch -M main
git push -u origin main

Write-Host ''
Write-Host '完成！去 Vercel 部署吧：' -ForegroundColor Green
Write-Host 'https://vercel.com/new'
