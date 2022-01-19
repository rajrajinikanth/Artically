'use strict';
 
import got from 'got';
import * as chrono from 'chrono-node';

// Define "require"
import { createRequire } from "module";
const require = createRequire(import.meta.url);

var { Readability } = require('@mozilla/readability');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const urlHandler = require('url');
var urljoin = require('url-join');
const cheerio = require('cheerio');
var WordPressApi = require( 'wpapi' );
const Redis = require("ioredis");

const REDIS_URL = "192.168.86.250";
const REDIS_PORT = 6379;
const redis = new Redis(REDIS_PORT, REDIS_URL);  
const cliParams = process.argv.slice(2);
var docName = cliParams[0];
var configKey = 'artically.'+ docName +'.config'


 var config = JSON.parse(await getRedisValue(configKey));
 
var content = await getArticle(config);
await publishArticle(content);

async function getArticle(configitem){

    var editorial_home_url = configitem.editorial_home_url;
    var pattern = configitem.editorial_article_pattern;
    const contentBody = await got(editorial_home_url);
    const $content = cheerio.load(contentBody.body);
    var articleUrl = resolveUrl(editorial_home_url,$content(pattern).attr('href'));
    
    const {body} = await got(articleUrl); 
    const $ = cheerio.load(body);
    const dom = new JSDOM(body);
    let reader = new Readability(dom.window.document);
    let article = reader.parse();
    var article_content = article.textContent.replace(/\r?\n|\r/g, " ");
    var article_html = article.content.replace(/\r?\n|\r/g, " ");
    var jsonArticle = {
        articleUrl: articleUrl,
        articleDt: getArticleDate($, configitem.editorial_date_pattern),
        articleTitle: article.title,
        articleContent: article_content.trim(),
        articleAuthor: configitem.editorial_author
    };

    return jsonArticle;
}

async function publishArticle(content){
    var wp_endpoint = await getRedisValue('artically.wordpress.endpoint');
    var wp_credentials = decodeBase64(await getRedisValue('artically.wordpress.credentials'));
    var wp_username = wp_credentials.split(':')[0];
    var wp_password = wp_credentials.split(':')[1];
   
       var wp = new WordPressApi({
           endpoint: wp_endpoint,
           username: wp_username,
           password: wp_password
       });
   
       wp.posts().create({
           title: content.articleTitle,
           content: content.articleContent,
           status: 'publish'        
       }).then(function( response ) {
           console.log( response.id );
       }).catch(function( err ) {
           console.log(err);
       });
   }

async function getRedisValue(Key){
    const config = redis.get(Key).then(function (result) {        
		return result;
      });
    return config;
} 

function getArticleDate($, expr) {
    var value = $(expr).first().text() || $(expr).text() || $(expr).attr('content');
    return typeof value !== 'undefined' && value ? chrono.parseDate(value) : '';
}

function resolveUrl(baseUrl,articleUrl){				
	var parsedBaseUrl = urlHandler.parse(baseUrl, true,true)
	var parsedArticleUrl = urlHandler.parse(articleUrl, true,true)
	var protocol = parsedArticleUrl.protocol ?? parsedBaseUrl.protocol;
	var urlPath = parsedArticleUrl.path.indexOf("/") != -1 ? parsedArticleUrl.path : '/' + parsedArticleUrl.path;
	var resolvedUrl =  protocol + "//" + parsedBaseUrl.host + urlPath;
	return resolvedUrl;		
}

function decodeBase64(enc_value){
	let buff = Buffer.from(enc_value, 'base64');  
	return buff.toString('utf-8');
}

redis.disconnect();
