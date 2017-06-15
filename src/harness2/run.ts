import { Runner } from "./runner";

let iterations = 1;

function getRunners(): Runner[] {
    return [];
}

function runTests(runners: Runner[]) {
    for (let i = iterations; i > 0; i--) {
        for (const _runner of runners) {
            // runner.initializeTests();
        }
    }
}

runTests(getRunners());