# QuickJS FFI on Windows 调用自定义 C DLL

基于 [BBDXF/quickjs_cmake](https://github.com/BBDXF/quickjs_cmake) + [shajunxing/quickjs-ffi](https://github.com/shajunxing/quickjs-ffi)，在 Windows 上用 QuickJS (qjs) 通过 FFI 调用自定义 C 库。

---

## 环境要求

- Windows 10/11
- [MSYS2](https://www.msys2.org/)（使用 UCRT64 终端）

---

## 第一步：安装 MSYS2 依赖

打开 **MSYS2 UCRT64** 终端：

```bash
pacman -S mingw-w64-ucrt-x86_64-gcc \
          mingw-w64-ucrt-x86_64-cmake \
          mingw-w64-ucrt-x86_64-libffi \
          git make
```

---

## 第二步：克隆并编译 quickjs_cmake

```bash
git clone https://github.com/BBDXF/quickjs_cmake.git
cd quickjs_cmake
git submodule update --init --depth=1

mkdir build && cd build
cmake .. -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release
mingw32-make
```

编译完成后 `build/` 目录会生成：
- `qjs.exe` — JS 解释器
- `libquickjs-ffi.dll` — FFI 模块
- `libquickjs.dll` — QuickJS 运行库

---

## 第三步：修复 Windows 动态模块加载（关键！）

原版 `quickjs-libc.c` 在 Windows 下 `js_module_loader_so` 是空实现，需要替换成真正用 `LoadLibrary` 加载的版本。

找到 `quickjs/quickjs-libc.c`，搜索 `js_module_loader_so`，把 Windows 那段替换为：

```c
#if defined(_WIN32)
#include <windows.h>

static JSModuleDef *js_module_loader_so(JSContext *ctx,
                                        const char *module_name)
{
    JSModuleDef *m;
    HMODULE hd;
    JSInitModuleFunc *init;
    char abs_path[MAX_PATH];

    if (GetFullPathNameA(module_name, MAX_PATH, abs_path, NULL) == 0) {
        JS_ThrowReferenceError(ctx, "could not resolve path '%s'", module_name);
        return NULL;
    }

    hd = LoadLibraryA(abs_path);
    if (!hd) {
        JS_ThrowReferenceError(ctx, "could not load module '%s' as shared library",
                               module_name);
        return NULL;
    }

    init = (JSInitModuleFunc *)GetProcAddress(hd, "js_init_module");
    if (!init) {
        FreeLibrary(hd);
        JS_ThrowReferenceError(ctx, "could not load js_init_module in '%s'",
                               module_name);
        return NULL;
    }

    m = init(ctx, module_name);
    if (!m) {
        FreeLibrary(hd);
        return NULL;
    }
    return m;
}
```

修改后重新编译：

```bash
cd build
mingw32-make
```

---

## 第四步：准备 FFI 文件

```bash
# 在 MSYS2 里，将 libquickjs-ffi.dll 改名为 quickjs-ffi.so 放到 js/ 目录
cp build/libquickjs-ffi.dll js/quickjs-ffi.so

# 复制 libffi-8.dll 到 js/ 目录（关键！缺少此文件会报加载失败）
cp /ucrt64/bin/libffi-8.dll js/
```

---

## 第五步：编写并编译自定义 C 库

在项目根目录创建 `myadd.c`：

```c
__declspec(dllexport) int add(int a, int b) {
    return a + b;
}
```

编译：

```bash
gcc -shared -o js/myadd.dll myadd.c
```

---

## 第六步：编写 JS 调用脚本

创建 `js/test_add.js`：

```js
import { CFunction } from './quickjs-ffi.js'

let add = new CFunction('./myadd.dll', 'add', null, 'int', 'int', 'int');
console.log('add(3, 5) =', add.invoke(3, 5));  // 输出: add(3, 5) = 8
add.free();
```

---

## 第七步：运行

**在 MSYS2 UCRT64 终端：**

```bash
cd /c/Users/你的用户名/Desktop/quickjs_cmake/js
../build/qjs.exe test_add.js
```

**在 Windows PowerShell：**

```powershell
cd C:\path\to\quickjs_cmake\js
..\build\qjs.exe test_add.js
```

期望输出：

```
add(3, 5) = 8
```

---

## 最终文件结构

```
quickjs_cmake/
├── build/
│   ├── qjs.exe                ← JS 解释器
│   ├── libquickjs.dll         ← QuickJS 运行库
│   ├── libgcc_s_seh-1.dll     ← MinGW 运行库
│   └── libwinpthread-1.dll    ← MinGW 线程库
├── js/
│   ├── quickjs-ffi.js         ← FFI JS 封装（项目自带）
│   ├── quickjs-ffi.so         ← libquickjs-ffi.dll 改名复制
│   ├── libffi-8.dll           ← libffi 运行库（从 /ucrt64/bin/ 复制）
│   ├── myadd.dll              ← 自定义 C 库
│   └── test_add.js            ← JS 调用脚本
└── myadd.c                    ← C 源码
```

---

## CFunction 类型对照表

| C 类型 | CFunction 字符串 |
|--------|----------------|
| `int` | `'int'` |
| `double` | `'double'` |
| `float` | `'float'` |
| `char *` | `'string'` |
| `void` | `'void'` |
| `void *` | `'pointer'` |
| `long` | `'long'` |

CFunction 构造参数顺序：`库名, 函数名, nfixedargs(普通函数填null), 返回类型, 参数类型...`

```js
// int add(int a, int b)
new CFunction('./myadd.dll', 'add', null, 'int', 'int', 'int')

// double addf(double a, double b)
new CFunction('./myadd.dll', 'addf', null, 'double', 'double', 'double')

// 可变参数函数，如 printf(const char *fmt, ...)，1 表示 1 个固定参数
new CFunction('msvcrt.dll', 'printf', 1, 'int', 'string', 'double')
```

---

## 部署到客户电脑

客户电脑**不需要安装任何环境**，只需打包以下文件：

```
发布包/
├── build/
│   ├── qjs.exe
│   ├── libquickjs.dll
│   ├── libgcc_s_seh-1.dll
│   └── libwinpthread-1.dll
└── js/
    ├── quickjs-ffi.js
    ├── quickjs-ffi.so
    ├── libffi-8.dll
    ├── myadd.dll
    └── your_script.js
```

---

## 常见问题

| 错误信息 | 原因 | 解决 |
|---------|------|------|
| `shared library modules are not supported yet` | quickjs-libc.c 未修改 | 按第三步修改并重新编译 |
| `could not load module 'quickjs-ffi.so'` | 缺少 `libffi-8.dll` | 复制 `/ucrt64/bin/libffi-8.dll` 到 `js/` |
| `clock_gettime64` 找不到 | 缺少 ucrt64 运行库 | 复制 `libgcc_s_seh-1.dll` 等到 `build/` |
| `ReferenceError: could not load module 'quickjs-ffi.js'` | 运行目录不对 | 必须在 `js/` 目录下运行 qjs |
