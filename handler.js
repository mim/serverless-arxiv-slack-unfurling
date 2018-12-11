'use strict';

const {WebClient} = require('@slack/client');
//const keyBy = require('lodash.keyby');
//const omit = require('lodash.omit');
//const mapValues = require('lodash.mapvalues');
var Promise = require('bluebird');
var rp = require('request-promise');
var parseString = Promise.promisify(require('xml2js').parseString);

const token = process.env.SLACK_VERIFICATION_TOKEN,
    accessToken = process.env.SLACK_ACCESS_TOKEN;


// From https://github.com/rshin/arxiv-slack-bot/blob/master/index.js
const ARXIV_ID   = /\d{4}\.\d{4,5}/;
const ARXIV_LINK = /(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:.pdf)?/g;
const ARXIV_API_URL = 'http://export.arxiv.org/api/query?search_query=id:';

const fetchArxiv = function (arxivId, callback) {
  return rp(ARXIV_API_URL + arxivId).then(parseApiResponseBody);
};

const parseApiResponseBody = function (body) {
  return parseString(body).then(result => {
    if (!result.feed.entry) {
      throw new Error('ArXiv entry not found');
    }
    var entry = result.feed.entry[0];
    return {
      id      : entry.id ?
                entry.id[0].split('/').pop() :
                '{No ID}',
      url     : entry.id ?
                entry.id[0] :
                '{No url}',
      title   : entry.title ?
                entry.title[0].trim().replace(/\n/g, ' ') :
                '{No title}',
      summary : entry.summary ?
                entry.summary[0].trim().replace(/\n/g, ' ') :
                '{No summary}',
      authors : entry.author ?
                entry.author.map(function (a) { return a.name[0]; }) :
                '{No authors}',
      categories : entry.category ? entry.category.map(c => c.$.term) : [],
      updated_time : Date.parse(entry.updated) / 1000,
    };
  });
}

const formatArxivAsAttachment = function (arxivData) {
    // testing...
    // return {text: "Hi this is a test"};
    
    return {
    author_name: arxivData.authors.join(', '),
    title      : '[' + arxivData.id + '] ' + arxivData.title,
    title_link : arxivData.url,
    text       : arxivData.summary,
    footer     : arxivData.categories.join(', '),
    footer_icon: 'https://arxiv.org/favicon.ico',
    ts         : arxivData.updated_time,
    color      : '#b31b1b',
  };
}


module.exports.unfurl = (event, context, callback) => {
    const payload = event.body;

    // verify necessary tokens are set in environment variables
    if (!token || !accessToken) {
        return callback("Slack verification token and access token should be set");
    }

    // Verification Token validation to make sure that the request comes from Slack
    if (token && token !== payload.token) {
        return callback("[401] Unauthorized");
    }

    if (payload.type === "event_callback") {
        const slack = new WebClient(accessToken);
        const event = payload.event;

        var unfurls = {};
    
        Promise.map(event.links, link => {
            if (link.domain !== 'arxiv.org') {
                throw new Error('incorrect link.domain: ' + link.domain);
            }
            return fetchArxiv(link.url.match(ARXIV_ID)[0]).then(arxiv => {
                unfurls[link.url] = formatArxivAsAttachment(arxiv);
            });
        }).then(() => {
            var form = {
                token: token,
                channel: event.channel,
                ts: event.message_ts,
                unfurls: JSON.stringify(unfurls)
            };
            // console.log(form)
            
            return rp.post({
                url: 'https://slack.com/api/chat.unfurl',
                form: form,
                headers: { 'content-type': "application/json" }
            });
        }).catch(err => {
            console.log('error:', err);
        });
        
        return callback();
    }
    // challenge sent by Slack when you first configure Events API
    else if (payload.type === "url_verification") {
        return callback(null, payload.challenge);
    } else {
        console.error("An unknown event type received.", event);
        return callback("Unkown event type received.");
    }

};
