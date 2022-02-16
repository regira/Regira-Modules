import { nodeResolve } from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";
import babel from "@rollup/plugin-babel";
import pkg from "./package.json";
import commonjs from 'rollup-plugin-commonjs';
import nodePolyfills from "rollup-plugin-node-polyfills";
import builtins from "rollup-plugin-node-globals";
import replace from "@rollup/plugin-replace";


const input = ["src/index.js"];
let moduleName = pkg.name;
moduleName = "regira";

export default [
    {
        // UMD
        input,
        plugins: [
            nodeResolve({
                browser: true
            }),
            commonjs(),
            babel({
                babelHelpers: "runtime",
                exclude: "node_modules/**", // only transpile our source code
                presets: ["@babel/preset-env"],
                plugins: [
                    "@babel/transform-runtime",
                    "@babel/transform-regenerator",
                    "@babel/transform-async-to-generator",
                ]
            }),
            terser(),
            builtins(),
            nodePolyfills()
        ],
        output: {
            file: `dist/${moduleName}.min.js`,
            format: "umd",
            name: "regira", // this is the name of the global object
            esModule: false,
            exports: "named",
            sourcemap: true
        },
    },
    // ESM and CJS
    {
        input,
        plugins: [
            nodeResolve(),
            commonjs(),
            builtins(),
            replace({
                'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
            })
        ],
        output: [
            {
                dir: "dist/esm",
                format: "esm",
                exports: "named",
                sourcemap: true,
            },
            {
                dir: "dist/cjs",
                format: "cjs",
                exports: "named",
                sourcemap: true,
            },
        ]
    },
];