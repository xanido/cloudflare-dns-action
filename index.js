const fs = require('fs');
const { hostname } = require('os');
const path = require('path');
const github = require('@actions/github');
const core = require('@actions/core');

const TOKEN = core.getInput('token') || process.env.CF_API_TOKEN;
const workspacePath = github.context.workspacePath || process.env.GITHUB_WORKSPACE;

const cf = require('cloudflare')({
    token: TOKEN
});

async function main() {
    const dockerComposeDefinition = fs.readFileSync(path.join(workspacePath, 'docker-compose.yml')).toString();
    
    const [,hostname] = dockerComposeDefinition.match(/Host\(`([^`]+)`\)/) || [];
    
    const hostparts = hostname.split('.');
    let zoneId;
    let cursor = hostparts.length;
    let zoneName;
    while (!zoneId && cursor > 0) {
        zoneName = hostparts.slice(0 - cursor).join('.');
        let zoneDetails;
        try {
            zoneDetails = await cf.zones.browse({name: zoneName});
        } catch (e) {}
        if(zoneDetails && zoneDetails.result && zoneDetails.result.length) {
            console.log(`found zone ${zoneDetails.result[0].name} (id: ${zoneDetails.result[0].id})`);
            zoneId = zoneDetails.result[0].id;
        }
        cursor--;
    }
    
    if(!zoneId) {
        throw Error(`could not find a zone for ${hostname}`);
    }

    const dnsName = hostname.substr(0, hostname.length - zoneName.length - 1);

    // check to see if the dns record already exists
    const dnsRecordResult = await cf.dnsRecords.browse(zoneId, {name: hostname});
    if(dnsRecordResult.result && dnsRecordResult.result.length) {
        console.log('record found, updating...')
        const recordCreationResult = await cf.dnsRecords.edit(zoneId, dnsRecordResult.result[0].id, {
            type: "CNAME",
            name: dnsName,
            content: "odin.xanido.net",
            ttl: 1, // 'automatic'
            proxied: true,
        });
        console.log(`updated record with id: ${dnsRecordResult.result[0].id}`);
    } else {
        console.log('record not found, creating...')
        const recordCreationResult = await cf.dnsRecords.add(zoneId, {
            type: "CNAME",
            name: dnsName,
            content: "odin.xanido.net",
            ttl: 1, // 'automatic'
            proxied: true,
        });
        console.log(`created record with id: ${recordCreationResult.result.id}`);
    }
}

main();