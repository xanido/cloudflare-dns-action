const fs = require('fs');
const { hostname } = require('os');
const path = require('path');
const github = require('@actions/github');
const core = require('@actions/core');

const name = core.getInput('name');
const content = core.getInput('content');
const TOKEN = core.getInput('token') || process.env.CF_API_TOKEN;
const workspacePath = github.context.workspacePath || process.env.GITHUB_WORKSPACE;

const cf = require('cloudflare')({
    token: TOKEN
});

// this action is specific to my needs.. if no `name` input is supplied
// then the action tries to determine it by parsing docker-compose.yml
// traefik labels.
const extractTraefikHostname = () => {
    const dockerComposeDefinition = fs.readFileSync(path.join(workspacePath, 'docker-compose.yml')).toString();
    const [, hostname] = dockerComposeDefinition.match(/Host\(`([^`]+)`\)/) || [];
    return hostname;
}

async function main() {
    const hostname = name || extractTraefikHostname();
    const hostparts = hostname.split('.');
    let zoneId;
    let cursor = hostparts.length;
    let zoneName;

    // pop segments from the name until we find a matching zone
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
    const dnsParams = {
        type: "CNAME",
        name: dnsName,
        content,
        ttl: 1, // 'automatic'
        proxied: true,
    };
        
    if(dnsRecordResult.result && dnsRecordResult.result.length) {
        console.log('record found, updating...')
        const recordCreationResult = await cf.dnsRecords.edit(zoneId, dnsRecordResult.result[0].id, dnsParams);
        console.log(`updated record with id: ${dnsRecordResult.result[0].id}`);
    } else {
        console.log('record not found, creating...')
        const recordCreationResult = await cf.dnsRecords.add(zoneId, dnsParams);
        console.log(`created record with id: ${recordCreationResult.result.id}`);
    }
}

main();