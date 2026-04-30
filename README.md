# File Refactor Engine

Dependency-aware file-system refactoring for Windows projects.

File Refactor Engine treats file moves and renames like code refactors: it scans project files, builds a path-reference graph, previews the impact, updates safe references, and writes a rollback manifest before applying changes.

## What It Does

- Scans project-local path references in these file types: .tex, .md, .py, .ipynb, .json, .yaml, and .yml.
- Supports safe `move` operations for files and directories.
- Supports batch `rename` operations with glob or regex patterns.
- Builds a dry-run report before touching files.
- Shows unified diffs for text edits.
- Updates only references that resolve to real files inside the selected project root.
- Reports unresolved, external, absolute, and unsafe paths instead of guessing.
- Saves rollback manifests under `.filerefactor/history/`.
- Rolls back applied refactors with hash checks to avoid overwriting user edits.

## Why This Exists

Code editors can safely rename symbols, update imports, and preview refactors. File systems usually cannot. When a research or software project reorganizes figures, data, notebooks, scripts, or configuration files, links inside LaTeX, Markdown, Python, notebooks, and configs often break silently.

This app makes those file-system changes explicit, reviewable, and reversible.

## Windows App Usage

1. Build or download the portable executable. For a local build, run `npm run package:win`, then open:

   ```text
   release/File Refactor Engine 0.1.0.exe
   ```

2. Click **Choose Project** and select the project root folder.
3. Review the indexed files and detected file types.
4. Choose an operation:
   - **Move**: move a file or directory, for example `figures` -> `paper/figures`.
   - **Rename**: rename files by glob or regex, for example `case_*.png` -> `Re_{1}_case{ext}`.
5. Click **Dry-run**.
6. Review file operations, reference updates, warnings, and blockers.
7. Click **Build Diff** to inspect exact text edits.
8. Click **Apply Refactor** only after reviewing the dry-run report.
9. Use **History And Rollback** to undo a previous refactor.

## Rename Template Tokens

Glob and regex rename templates support:

```text
{stem}   original filename without extension
{ext}    original extension, including the leading dot
{index}  1-based match index
{1}      first capture group
{2}      second capture group
{Name}   named regex group, such as (?<Name>...)
```

Example:

```text
Pattern:  case_*.png
Template: Re_{1}_case{ext}
Result:   case_100.png -> Re_100_case.png
```

## Safety Model

The first version is intentionally conservative.

- A project root is the safety boundary.
- The app does not modify files outside the selected project root.
- Existing destination files are never overwritten.
- External URLs, absolute paths, unresolved references, globs, and dynamic path expressions are reported but not auto-edited.
- Dry-run is required before apply.
- Rollback manifests are written before file moves are executed.
- Rollback checks file hashes and skips files that changed after the refactor.

## Supported Reference Types

Current conservative reference extraction covers:

- LaTeX commands:

  ```text
  \includegraphics{}
  \input{}
  \include{}
  \bibliography{}
  \addbibresource{}
  ```

- Markdown: normal links and image links.
- Python: string literals that resolve to real project files.
- Jupyter notebooks: markdown links and code-cell string paths; outputs are not edited.
- JSON/YAML: string values that resolve to real project files.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run type checks and build:

```bash
npm run build
```

Run the development app:

```bash
npm run dev
```

Build a Windows portable executable:

```bash
npm run package:win
```

## Project Structure

```text
src/core      refactor engine: scan, extract, plan, apply, rollback
src/main      Electron main process and IPC bridge
src/renderer  React user interface
tests         automated fixture tests
release       packaged Windows app output
```

## Test Coverage

The current automated tests cover:

- moving a LaTeX figure directory and updating includegraphics references
- renaming Markdown-linked images
- updating Python, JSON, and YAML string references
- updating notebook source references while leaving outputs untouched
- blocking overwrite conflicts
- reporting external and absolute references without auto-editing them
- rollback after apply
- rollback conflict detection when a user edits a file after apply
- paths with spaces and non-ASCII characters

Test fixtures are created in the system temporary directory and removed after each test.

## Known Limitations

- This is an early MVP.
- The app does not try to infer dynamic paths.
- It does not edit binary files.
- It does not perform fuzzy filename matching.
- It does not delete files.
- It does not yet provide a full interactive file-tree picker for source and destination paths.
- It currently uses the default Electron icon.

## Roadmap

- Richer file tree interactions in the GUI.
- Per-edit opt-out with dependency consistency checks.
- Git status and diff integration when the project is a Git repository.
- More parsers for HTML, CSS, JavaScript, TypeScript, TOML, and BibTeX.
- Custom app icon and release metadata.
- Signed installer builds for public releases.

## License

MIT. See [LICENSE](LICENSE).

---

# File Refactor Engine 中文说明

File Refactor Engine 是一个面向 Windows 的“文件系统重构”工具。

它把移动文件、重命名文件、整理项目目录这些操作，做得像 IDE 里的代码重构一样：先扫描项目中的路径引用，生成影响报告，预览 diff，确认后再执行，并在执行前写入可回滚记录。

## 它能做什么

- 扫描以下文件类型中的项目内路径引用：.tex、.md、.py、.ipynb、.json、.yaml、.yml。
- 支持安全移动文件或文件夹。
- 支持通过 glob 或 regex 批量重命名文件。
- 在真正修改文件前生成 dry-run 影响报告。
- 显示文本修改的 unified diff。
- 只自动更新能明确解析到项目内真实文件的路径。
- 对无法解析、外部链接、绝对路径、不安全路径只提示，不乱改。
- 执行后在 .filerefactor/history/ 中保存回滚记录。
- 回滚时检查文件 hash，避免覆盖用户后续修改。

## 为什么需要它

代码编辑器可以安全重命名函数、更新 import、预览重构结果。可是文件系统通常不行。

当你整理论文图片、仿真数据、notebook、脚本或配置文件时，LaTeX、Markdown、Python、notebook 和配置文件里的路径引用很容易悄悄断掉。

这个工具的目标是让文件整理变得可预览、可解释、可回滚。

## Windows 应用使用方法

1. 构建或下载 portable 程序。如果是本地构建，先运行 npm run package:win，然后打开：

   ```text
   release/File Refactor Engine 0.1.0.exe
   ```

2. 点击 **Choose Project**，选择项目根目录。
3. 查看扫描到的文件和文件类型统计。
4. 选择操作：
   - **Move**：移动文件或文件夹，例如 figures -> paper/figures。
   - **Rename**：通过 glob 或 regex 批量重命名，例如 case_*.png -> Re_{1}_case{ext}。
5. 点击 **Dry-run**。
6. 检查文件移动、引用更新、警告和阻塞项。
7. 点击 **Build Diff** 查看具体文本修改。
8. 确认无误后点击 **Apply Refactor**。
9. 在底部 **History And Rollback** 中可以回滚历史操作。

## 重命名模板

重命名模板支持：

```text
{stem}   原文件名，不含扩展名
{ext}    原扩展名，包含开头的点
{index}  匹配序号，从 1 开始
{1}      第一个捕获组
{2}      第二个捕获组
{Name}   regex 命名捕获组，例如 (?<Name>...)
```

示例：

```text
Pattern:  case_*.png
Template: Re_{1}_case{ext}
Result:   case_100.png -> Re_100_case.png
```

## 安全模型

第一版刻意保守。

- 项目根目录是安全边界。
- 不修改项目根目录外的文件。
- 不覆盖已存在的目标文件。
- 外部 URL、绝对路径、无法解析路径、glob 路径、动态路径表达式只报告，不自动编辑。
- 必须先 dry-run，才能 apply。
- 执行文件移动前会先写 rollback manifest。
- 回滚时会检查 hash；如果文件在重构后被用户改过，就跳过并报告冲突。

## 当前支持的引用类型

- LaTeX 命令：

  ```text
  \includegraphics{}
  \input{}
  \include{}
  \bibliography{}
  \addbibresource{}
  ```

- Markdown：普通链接和图片链接。
- Python：能解析到项目内真实文件的字符串字面量。
- Jupyter notebook：markdown cell 和 code cell 里的路径；不修改 outputs。
- JSON/YAML：能解析到项目内真实文件的字符串值。

## 开发命令

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

类型检查和构建：

```bash
npm run build
```

开发模式运行应用：

```bash
npm run dev
```

打包 Windows portable exe：

```bash
npm run package:win
```

## 项目结构

```text
src/core      核心重构引擎：扫描、提取引用、生成计划、执行、回滚
src/main      Electron 主进程和 IPC 桥接
src/renderer  React 图形界面
tests         自动化测试
release       Windows 打包输出
```

## 已覆盖测试

当前自动化测试覆盖：

- 移动 LaTeX 图片目录并更新 includegraphics 引用
- 重命名 Markdown 中引用的图片
- 更新 Python、JSON、YAML 字符串路径
- 更新 notebook source 中的路径，同时不修改 outputs
- 阻止覆盖已有目标文件
- 报告外部链接和绝对路径，但不自动修改
- 执行后的回滚
- 回滚前用户改动文件时的冲突检测
- 包含空格和中文字符的路径

测试夹具会创建在系统临时目录中，并在每个测试结束后自动删除。

## 已知限制

- 当前还是早期 MVP。
- 不推断动态路径。
- 不修改二进制文件内容。
- 不做模糊文件名匹配。
- 不做删除操作。
- GUI 里还没有完整的交互式文件树选择器。
- 当前使用 Electron 默认图标。

## 后续路线

- 更完整的文件树交互。
- 支持单条文本修改取消，并做依赖一致性检查。
- 如果项目是 Git 仓库，显示 git status 和 git diff。
- 增加 HTML、CSS、JavaScript、TypeScript、TOML、BibTeX 等解析器。
- 添加自定义图标和发布元数据。
- 公开发布前增加签名安装包。

## License

MIT。见 [LICENSE](LICENSE)。
