import { loadEnvs, validateEnvs } from "./core/env.js";
import { USER_AGENT, DEFAULTS, LIMITS } from "./util/constants.js";

const canonicalEnv = Object.freeze(structuredClone(process.env));
const env = loadEnvs();

const genericUserAgent = USER_AGENT;

export const setTunnelPort = (port) => env.tunnelPort = port;
export const isCluster = env.instanceCount > 1;
export const updateEnv = (newEnv) => {
    const changes = [];

    // tunnelPort is special and needs to get carried over here
    newEnv.tunnelPort = env.tunnelPort;

    for (const key in env) {
        if (key === 'subscribe') {
            continue;
        }

        if (String(env[key]) !== String(newEnv[key])) {
            changes.push(key);
        }
        env[key] = newEnv[key];
    }

    return changes;
}

await validateEnvs(env);

export {
    env,
    canonicalEnv,
    genericUserAgent,
}
