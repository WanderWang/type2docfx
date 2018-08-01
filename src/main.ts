#!/usr/bin/env node

import * as fs from 'fs-extra';
import * as serializer from 'js-yaml';
import * as program from 'commander';
import { traverse } from './jsonTraverse';
import { groupOrphanFunctions, insertFunctionToIndex, postTransform } from './postTransformer';
import { generateTOC } from './tocGenerator';
import { generatePackage } from './packageGenerator';
import { generateModules } from './moduleGenerator';
import { resolveIds } from './idResolver';
import { YamlModel, Syntax, YamlParameter, Root } from './interfaces/YamlModel';
import { TocItem } from './interfaces/TocItem';
import { UidMapping } from './interfaces/UidMapping';
import { RepoConfig } from './interfaces/RepoConfig';
import { yamlHeader } from './common/constants';
import { flags } from './common/flags';
import { ReferenceMapping } from './interfaces/ReferenceMapping';

let pjson = require('../package.json');

let path: string;
let outputPath: string;
let repoConfigPath: string;
program
    .version(`v${pjson.version}`)
    .description('A tool to convert the json format api file generated by TypeDoc to yaml format output files for docfx.')
    .option('--hasModule', 'Add the option if the source repository contains module.')
    .option('--disableAlphabetOrder', 'Add the option if you want to disable the alphabet order in output yaml.')
    .option('--basePath [value]', 'Current base path to the repository.')
    .option('--sourceUrl [value]', 'Define the source repository address.')
    .option('--sourceBranch [value]', 'Define the branch of source repository.')
    .arguments('<inputFile> <outputFolder> [repoConfigureFile]')
    .action(function (input: string, output: string, repoConfig: string) {
        path = input;
        outputPath = output;
        repoConfigPath = repoConfig;
    })
    .parse(process.argv);

if (!path || !outputPath) {
    console.log('Error: The input file path and output folder path is not specified!');
    program.help();
}

let repoConfig: RepoConfig;
if (repoConfigPath && program.basePath) {
    if (fs.existsSync(repoConfigPath)) {
        let temp = JSON.parse(fs.readFileSync(repoConfigPath).toString());
        repoConfig = {
            repo: temp.repo,
            branch: temp.branch,
            basePath: program.basePath
        };
    } else {
        console.log(`Error: repository config file path {${repoConfigPath}} doesn't exit!`);
        program.help();
    }
}

if (!repoConfig && program.sourceUrl && program.sourceBranch && program.basePath) {
    repoConfig = {
        repo: program.sourceUrl,
        branch: program.sourceBranch,
        basePath: program.basePath
    };
}

if (program.disableAlphabetOrder) {
    flags.enableAlphabetOrder = false;
}

let json = null;
if (fs.existsSync(path)) {
    let dataStr = fs.readFileSync(path).toString();
    json = JSON.parse(dataStr);
} else {
    console.error('Api doc file ' + path + ' doesn\'t exist.');
    program.help();
}

let rootElements: YamlModel[] = [];
let rootElementsForTOC: YamlModel[] = [];
let uidMapping: UidMapping = {};
let referenceMappings: ReferenceMapping[] = [];
if (json) {
    traverse(json, '', rootElements, null, uidMapping, repoConfig);
}

if (rootElements && rootElements.length) {
    rootElements.forEach(rootElement => {
        let referenceMapping = {};
        resolveIds(rootElement, uidMapping, referenceMapping);
        referenceMappings.push(referenceMapping);
    });

    rootElementsForTOC = JSON.parse(JSON.stringify(rootElements));

    let flattenElements = rootElements.map((rootElement, index) => {
        if (rootElement.uid.indexOf('constructor') >= 0) {
            return [];
        }

        return postTransform(rootElement, referenceMappings[index]);
    }).reduce(function (a, b) {
        return a.concat(b);
    }, []);

    console.log('Yaml dump start.');
    fs.ensureDirSync(outputPath);
    flattenElements.forEach(transfomredClass => {
        transfomredClass = JSON.parse(JSON.stringify(transfomredClass));
        let filename = transfomredClass.items[0].uid.replace(`${transfomredClass.items[0].package}.`, '');
        filename = filename.split('(')[0];
        filename = filename.replace(/\//g, '.');
        console.log(`Dump ${outputPath}/${filename}.yml`);
        fs.writeFileSync(`${outputPath}/${filename}.yml`, `${yamlHeader}\n${serializer.safeDump(transfomredClass)}`);
    });
    console.log('Yaml dump end.');

    let yamlModels: YamlModel[] = [];
    flattenElements.forEach(element => {
        yamlModels.push(element.items[0]);
    });

    let packageIndex = generatePackage(yamlModels);
    packageIndex = JSON.parse(JSON.stringify(packageIndex));
    fs.writeFileSync(`${outputPath}/index.yml`, `${yamlHeader}\n${serializer.safeDump(packageIndex)}`);
    console.log('Package index genrated.');

    let toc = generateTOC(rootElementsForTOC, flattenElements[0].items[0].package);
    toc = JSON.parse(JSON.stringify(toc));
    fs.writeFileSync(`${outputPath}/toc.yml`, serializer.safeDump(toc));
    console.log('Toc genrated.');

}
