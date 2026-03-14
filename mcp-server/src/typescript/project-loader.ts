import path from 'node:path';

import ts from 'typescript';

export interface TypeScriptProjectContext {
  repositoryRoot: string;
  tsconfigPath: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  languageService: ts.LanguageService;
}

const PROJECT_CACHE = new Map<string, TypeScriptProjectContext | null>();

function normalizePath(value: string): string {
  return path.resolve(value);
}

function hasBlockingDiagnostics(diagnostics: readonly ts.Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
}

function createProjectContext(
  repositoryRoot: string,
  tsconfigPath: string,
): TypeScriptProjectContext | null {
  try {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

    if (configFile.error) {
      return null;
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(tsconfigPath),
      undefined,
      tsconfigPath,
    );

    if (hasBlockingDiagnostics(parsedConfig.errors) || parsedConfig.fileNames.length === 0) {
      return null;
    }

    const program = ts.createProgram({
      rootNames: parsedConfig.fileNames,
      options: parsedConfig.options,
      projectReferences: parsedConfig.projectReferences,
    });
    const languageServiceHost: ts.LanguageServiceHost = {
      getCompilationSettings: () => parsedConfig.options,
      getCurrentDirectory: () => path.dirname(tsconfigPath),
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      getScriptFileNames: () => parsedConfig.fileNames,
      getScriptSnapshot: (fileName) => {
        const content = ts.sys.readFile(fileName);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getScriptVersion: () => '0',
      directoryExists: ts.sys.directoryExists,
      fileExists: ts.sys.fileExists,
      getDirectories: ts.sys.getDirectories,
      readDirectory: ts.sys.readDirectory,
      readFile: ts.sys.readFile,
      realpath: ts.sys.realpath,
    };
    const languageService = ts.createLanguageService(
      languageServiceHost,
      ts.createDocumentRegistry(),
    );

    return {
      repositoryRoot: normalizePath(repositoryRoot),
      tsconfigPath: normalizePath(tsconfigPath),
      program,
      checker: program.getTypeChecker(),
      languageService,
    };
  } catch {
    return null;
  }
}

export function loadTypeScriptProject(
  repositoryRoot: string,
  tsconfigPath: string,
): TypeScriptProjectContext | null {
  const normalizedTsconfigPath = normalizePath(tsconfigPath);

  if (PROJECT_CACHE.has(normalizedTsconfigPath)) {
    return PROJECT_CACHE.get(normalizedTsconfigPath) ?? null;
  }

  const context = createProjectContext(repositoryRoot, normalizedTsconfigPath);
  PROJECT_CACHE.set(normalizedTsconfigPath, context);
  return context;
}

export function clearTypeScriptProjectCache(): void {
  PROJECT_CACHE.clear();
}
