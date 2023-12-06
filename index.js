import fs from 'node:fs';
import superagent from 'superagent';
import UserAgent from 'user-agents';

const SPIN_INSTANCE_ID = '4dd6yg'

const specialFormatTime = () => {
    const now = new Date();

    const pad = (number) => number.toString().padStart(2, '0');
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    return year + month + day + hours + minutes + seconds;
}
const print = (...args) => {
    const time = `[${new Date().toLocaleTimeString()}]`;
    return console.log(time, ...args);
}

class Wheel {
    constructor() {
        this.agent = 
            new superagent
                .agent()
                .set('user-agent', new UserAgent().toString());
    }

    createSession = () => new Promise(resolve => {
        this.agent
            .get(`https://digicpn.com/p/${SPIN_INSTANCE_ID}`)
            .then(resp => {
                this.finalId =
                    resp.redirects
                        .pop()
                        .split('/')
                        .pop();

                const html = resp.text;
                this.pid = html.split('&pid=')[1].split('"')[0];

                print(`Created new wheel instance: ${this.finalId} (${this.pid})`);

                return resolve(this.finalId);
            })
            .catch(error => {
                print(
                    'Failed to generate session token:',
                    error.response ? error.response.body : error)
            })
    })

    calculateSpinData = () => new Promise(resolve => {
        this.agent
            .get('https://digicpn.com/includes/spindata.php')
            .query({
                code: SPIN_INSTANCE_ID,
                cookie: this.finalId,
                datetime: specialFormatTime()
            })
            .then(resp => {
                const {
                    spinDestinationArray,
                    segmentValuesArray
                } = resp.body;

                const destination = spinDestinationArray.pop() - 1;
                const actualLanding = segmentValuesArray[destination];

                // boolean and string lovely
                if (actualLanding.win === 'lose') {
                    print(`Wheel was a loser :(`)   
                    return resolve();
                }

                const fancyRewardName = actualLanding.resultText.replace(/\^/g, ' ')
                print(`Wheel ${this.finalId} won ${fancyRewardName}`)

                return resolve(fancyRewardName);
            })
            .catch(error => {
                print(
                    'Failed to calculate spin reward:',
                    error.response ? error.response.body : error);

                return resolve();
            })
    })

    // save_played or save_win
    postAnalytics = (type) => new Promise(resolve => {
        this.agent
            .post(`https://digicpn.com/includes/ajax_${type}.php`)
            .query({
                cookie: this.finalId,
                pid: this.pid,
                type: 'spin'
            })
            .then(() => {
                return resolve(true);
            })
            .catch(error => {
                print('Failed to set saved win analytics:', error.response ? error.response.error : error);
                return resolve();
            })
    })

    preliminaryProcessing = (path) => new Promise(resolve => {
        this.agent.get(`https://digicpn.com/${path}/${SPIN_INSTANCE_ID}/${this.finalId}`)
            .then(() => {
                return resolve(true);
            })
            .catch(error => {
                print(
                    `Failed to get process code init for path ${code}:`,
                    error.response ? error.response.body : error);
        
                return resolve();
            })
    })

    getCouponCode = () => new Promise(resolve => {
        this.agent
            .get(`https://digicpn.com/v/${SPIN_INSTANCE_ID}/${this.finalId}`)
            .then(resp => {
                const html = resp.text;
                const code =
                    html
                        .split('id="custom_code">')[1]
                        .split('</')[0]
                        .replace(/[^A-Z]/g, '');

                return resolve(code);
            })
            .catch(error => {
                print(
                    'Failed to get final winning code:',
                    error.response ? error.response.body : error);

                return resolve();
            })
    })

    spin = async () => {
        await this.createSession();
        const reward = await this.calculateSpinData();

        if (!reward) return;

        for (const endpoint of ['save_played', 'save_win'])
            await this.postAnalytics(endpoint);

        for (const path of ['pa', 'c'])
            await this.preliminaryProcessing(path);

        const coupon = await this.getCouponCode();
        if (!coupon) return;

        fs.appendFileSync('rewards.txt', `${reward}: ${coupon}\n`);
        print(`Wrote ${reward} coupon (${coupon}) to file.`);
    }
}

for (;;) {
    const promises = [];

    for (let i = 0; i < 10; i++)
        promises.push(new Wheel().spin());

    await Promise.all(promises);
}