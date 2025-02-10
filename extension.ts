import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';

let cacheFolder: string; // 缓存根目录
let cacheFile: string; // 缓存
let JSONFile: string;
let position: number;

// 极端错误强制退出并不再被激活
let EXTREME_ERROR:boolean = false;

function activate(context: vscode.ExtensionContext): void {
    // 极端错误处理
    if (EXTREME_ERROR) {
        vscode.window.showErrorMessage('程序遭遇极端错误，请联系开发者，如需重新启动，请禁用并重新启用本插件');
        return;
    }

    // 设置缓存文件
    cacheFolder = context.globalStorageUri.fsPath + '/'; // 缓存根目录
    cacheFile = cacheFolder + "cacheFile"; // 缓存
    JSONFile = cacheFolder + "JSONFile";

    // 读取position
    try {
        fse.accessSync(JSONFile);
    } catch (err) {
        if (err) {
            position = 0;
        }
    }
    if (position === undefined)
        position = fse.readJSONSync(JSONFile).position;

    let hide = false;


    // 保证父目录存在
    try {
        fse.accessSync(cacheFolder);
    } catch (err) {
        if (err) {
            fse.mkdirSync(cacheFolder);
        } else {
            const tempstats = fse.statSync(cacheFolder);
            if (!tempstats.isDirectory()) {
                fse.unlinkSync(cacheFolder);
                fse.mkdirSync(cacheFolder);
            }
        }
    }

    function WorkInit(): void {
        vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: {
                'Text': ['txt', 'in', 'out', 'ans'],
                'Code': ['c', 'cpp', 'py', 'java', 'go', 'cs', 'rs', 'php', 'html', 'css', 'js', 'json', 'xml', 'sh', 'bat', 'lua', 'sql', 'md', 'conf', 'log', 'gitignore', 'gitattributes']
            },
            openLabel: '选择'
        }).then((uri: vscode.Uri[] | undefined) => {
            if (uri && uri[0]) {
                const frmfile: string = uri[0].fsPath;
                try {
                    fse.accessSync(frmfile);
                } catch (err) {
                    if (err) {
                        vscode.window.showErrorMessage('文件不存在或不可读！');
                        console.error(`${frmfile} ${err.code === 'ENOENT' ? '不存在' : '只可读'}`);
                    }
                }
                const buffer: Buffer = fse.readFileSync(frmfile);

                const encoding: string = chardet.detect(buffer) || 'utf8';

                // 测试是否为二进制文件
                for (let i = 0; i < buffer.length; i++) {
                    if (buffer[i] === 0) {
                        vscode.window.showErrorMessage('二进制文件不支持！');
                        return;
                    }
                }

                let text: string;
                if (encoding.toLowerCase() !== 'utf-8') {
                    text = iconv.decode(buffer, encoding);
                } else {
                    text = buffer.toString('utf8');
                }

                text = "\n" + text.replaceAll("\r", "\n") + "\n";
                text = text.replace(/\n\n+/g, "\n");
                text = text.substring(1) + "-- END --\n";

                Buffer.from(text, 'binary')
                fse.writeFileSync(cacheFile, iconv.encode(text, 'utf32le'));

                // 初始化指针为0
                position = 0;

                vscode.window.showInformationMessage('读取执行完毕');
            }
        });
    }

    let text: string = "";

    // 从缓存读取所需内容
    function Read(): string {
        const config: ConfigType = ReadConfig();

        // 检查文件是否读取完/读到头
        const stats: fse.Stats = fse.statSync(cacheFile);
        if (position >= stats.size / 4) {
            position = stats.size;
            vscode.window.showInformationMessage(`读完了呢。`);
            return "";
        }
        if (position < 0) {
            position = 0;
            vscode.window.showInformationMessage(`到头了呢。`);
            return "";
        }

        const readingFile: number = fse.openSync(cacheFile, 'r');

        let length = Math.min(config.wordslimit, stats.size - position);// 计算需要读取长度
        const buffer = Buffer.alloc(length * 4, 0);
        length = fse.readSync(readingFile, buffer, 0, length * 4, position * 4) / 4;

        const readText: string = iconv.decode(buffer, 'utf32le');

        // 处理换行符
        const newlineIndex = readText.indexOf('\n');// 寻找换行符


        // 是否存在换行符
        if (newlineIndex !== -1) {
            text = readText.slice(0, newlineIndex);
            position += newlineIndex + 1;
        } else {
            text = readText;
            position += length;
        }

        return text;
    }

    // 向工作区写入
    function Write(text: string = Read()) {
        const config: ConfigType = ReadConfig();
        // 如果不存在标志符
        if (config.editor.document.getText().indexOf(config.sign) === -1) {
            config.editor.edit(editBuilder => {
                const begin = new vscode.Position(config.editor.selection.active.line, 0);
                editBuilder.insert(begin, config.sign + "\n");
            });
        }

        for (let lineNumber = 0; lineNumber < config.editor.document.lineCount; ++lineNumber) {

            // 寻找标记位置
            const textOfThisLine: vscode.TextLine = config.editor.document.lineAt(lineNumber);
            let indexPosition: number = textOfThisLine.text.indexOf(config.sign);

            // 替换文本
            if (indexPosition !== -1) {
                indexPosition += config.sign.length;
                config.editor.edit(editBuilder => {
                    const range: vscode.Range = new vscode.Range(lineNumber, indexPosition, lineNumber, textOfThisLine.text.length);
                    editBuilder.replace(range, text);
                });
                break;
            }
        }
    }

    // 显示下一句
    async function WorkNext(): Promise<void> {
        Write();
    }

    //显示上一句
    async function WorkLast(): Promise<void> {
        const config = ReadConfig();
        position -= config.wordslimit * 2;
        Write();
    }

    function CheckCache(): void {
        try {
            fse.accessSync(cacheFile, fse.constants.F_OK | fse.constants.W_OK);
        } catch (err) {
            if (err) {
                WorkInit();
            }
            return;
        }
        if (position === undefined)
            WorkInit();

    }

    function f_init(): void {
        hide = false;
        WorkInit();
    }

    function f_next(): void {
        hide = false;
        CheckCache();
        WorkNext();
    }

    function f_last(): void {
        hide = false;
        CheckCache();
        WorkLast();
    }

    // 老板键
    hide = false

    function f_hide(): void {
        if (hide === false) {
            Write("");
            hide = true;
        } else {
            hide = false;
            Write(text);
        }
    }

    // 注册命令
    context.subscriptions.push(vscode.commands.registerCommand('txt-read-in-code-comments.init', f_init));
    context.subscriptions.push(vscode.commands.registerCommand('txt-read-in-code-comments.next', f_next));
    context.subscriptions.push(vscode.commands.registerCommand('txt-read-in-code-comments.last', f_last));
    context.subscriptions.push(vscode.commands.registerCommand('txt-read-in-code-comments.hide', f_hide));
}

// 判断是否在编辑器中
function InEditor(): boolean {
    if (vscode.window.activeTextEditor===undefined) {
        return false;
    } else {
        return true;
    }
    ThrowError(ERROR_IMPOSSIBLE);
}

// 读取配置文件
type ConfigType = {
    editor: vscode.TextEditor,
    wordslimit: number,
    lang: string,
    sign: string
};

function ReadConfig(): ConfigType {
    // 读取配置文件
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const wordslimit: number = vscode.workspace.getConfiguration().get("txt-read-in-code-comments.WordsLimit");// 每行最大字数
    const lang: string = editor.document.languageId;// 语言 ID
    const Sign: object = vscode.workspace.getConfiguration().get("txt-read-in-code-comments.Sign");// 标志符

    // 临时代码-TO-BE-MODIFIED
    let sign: string;
    if (true) {// 检查Sign
        if (typeof Sign != "object") {
            ThrowError(ERROR_SIGN_SETTING);
        }
        if (typeof Sign[lang] == "object" && typeof Sign[lang].a == "string") {
            sign = Sign[lang].a;
        } else if (typeof Sign["default"] == "object" && typeof Sign["default"].a == "string") {
            sign = Sign["default"].a;
        } else {
            ThrowError(ERROR_SIGN_SETTING);
        }
    }

    const config: ConfigType = {
        editor: editor,
        wordslimit: wordslimit,
        lang: lang,
        sign: sign
    }
    if (CheckConfig(config) == false) {
        ThrowError(ERROR_IMPOSSIBLE);
    }
    return config;
}

// 检测配置文件
function CheckConfig(config: ConfigType): boolean {
    // 检查WordsLimit
    if (!(config.wordslimit > 0)) {
        ThrowError(ERROR_WORDSLIMIT);
        return false;
    }

    return true;

}

// 错误集中处理
type ErrorType = number;
const ERROR_UNKNOWN: ErrorType = -1;
const ERROR_SIGN_SETTING: ErrorType = 2;
const ERROR_FILE_NOT_FOUND: ErrorType = 3;
const ERROR_WORDSLIMIT: ErrorType = 4;
const ERROR_IMPOSSIBLE: ErrorType = 114514;

function ThrowError(err: ErrorType): void {
    switch (err) {
        case ERROR_UNKNOWN:
            vscode.window.showErrorMessage(`未知错误(ﾟДﾟ*)ﾉ，请联系开发者`);
            ExtremeErrorExitAndDeactive(err);
            break;
        case ERROR_SIGN_SETTING:
            vscode.window.showErrorMessage(`请检查标志符设定╰（‵□′）╯`);
            ErrorExit(err);
            break;
        case ERROR_WORDSLIMIT:
            vscode.window.showErrorMessage(`请检查每行最大字数设定（￣︶￣）↗`);
            ErrorExit(err);
            break;
        case ERROR_IMPOSSIBLE:
            vscode.window.showErrorMessage(`不可能的错误(╯‵□′)╯︵┻━┻，你这代码有问题啊，快去嘲笑开发者。`);
            ExtremeErrorExitAndDeactive(err);
            break;
        default:
            vscode.window.showErrorMessage(`未正确处理的错误😂，请联系开发者。`);
            ExtremeErrorExitAndDeactive(err);
            break;
    }
    ThrowError(ERROR_IMPOSSIBLE);
}

// 因错误强制退出
function ErrorExit(err: ErrorType): never {
    throw new Error(`Error: ${err}`);
}


function ExtremeErrorExitAndDeactive(err: ErrorType): never {
    EXTREME_ERROR = true
    deactivate();
    throw new Error(`Error: ${err}`);
}

// This method is called when your extension is deactivated
function deactivate() {
    // 保存临时配置文件
    const jsonData: object = {position}
    fse.writeJSONSync(JSONFile, jsonData);
}

module.exports = {
    activate,
    deactivate
}