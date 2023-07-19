'use strict';

import got from 'got';
import * as chrono from 'chrono-node';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import urlHandler from 'url';
import urljoin from 'url-join';
import cheerio from 'cheerio';
import WordPressApi from 'wpapi';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
dotenv.config();

const cliParams = process.argv.slice(2);
const docName = cliParams[0];
const configKey = `artically.${docName}.config`;

async function main() {
  const config = JSON.parse(getEnvValue(configKey));

  const content = await getArticle(config);
  await publishArticle(content);
}

async function getArticle(configitem) {
  const { editorial_home_url, editorial_article_pattern, editorial_date_pattern, editorial_author } = configitem;
  const contentBody = await got(editorial_home_url);
  const $content = cheerio.load(contentBody.body);
  const articleUrl = resolveUrl(editorial_home_url, $content(editorial_article_pattern).attr('href'));

  const { body } = await got(articleUrl);
  const $ = cheerio.load(body);
  const dom = new JSDOM(body);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const article_content = article.textContent.replace(/\r?\n|\r/g, ' ');
  const article_html = article.content.replace(/\r?\n|\r/g, ' ');
  const jsonArticle = {
    articleUrl: articleUrl,
    articleDt: getArticleDate($, editorial_date_pattern),
    articleTitle: article.title,
    articleContent: article_content.trim(),
    articleAuthor: editorial_author,
  };

  return jsonArticle;
}

async function publishArticle(content) {
  const wp_endpoint = process.env.WORDPRESS_ENDPOINT;
  const wp_credentials = decodeBase64(process.env.WORDPRESS_CREDENTIALS);
  const wp_username = wp_credentials.split(':')[0];
  const wp_password = wp_credentials.split(':')[1];

  const wp = new WordPressApi({
    endpoint: wp_endpoint,
    username: wp_username,
    password: wp_password,
  });

  const tag = await wp.tags().slug(docName).then((tag) => tag[0].id);
  const cat = await wp.categories().slug('editorial').then((cat) => cat[0].id);

  let metaformat = getEnvValue('artically.metaformat.config');

  metaformat = metaformat.replace('@article.sourceurl', content.articleUrl);
  metaformat = metaformat.replace('@article.sourcedate', content.articleDt);
  metaformat = metaformat.replace('@article.sourcename', docName);

  wp.posts()
    .create({
      title: content.articleTitle,
      content: metaformat + content.articleContent,
      slug: docName,
      tags: [tag],
      categories: [cat],
      status: 'publish',
    })
    .then((response) => {
      console.log(response.id);
    })
    .catch((err) => {
      console.log(err);
    });
}

function getEnvValue(key) {
  const value = process.env[key];
  return value;
}

function getArticleDate($, expr) {
  const value = $(expr).first().text() || $(expr).text() || $(expr).attr('content');
  return typeof value !== 'undefined' && value ? chrono.parseDate(value) : '';
}

function resolveUrl(baseUrl, articleUrl) {
  const parsedBaseUrl = urlHandler.parse(baseUrl, true, true);
  const parsedArticleUrl = urlHandler.parse(articleUrl, true, true);
  const protocol = parsedArticleUrl.protocol ?? parsedBaseUrl.protocol;
  const urlPath = parsedArticleUrl.path.indexOf('/') != -1 ? parsedArticleUrl.path : '/' + parsedArticleUrl.path;
  const resolvedUrl = protocol + '//' + parsedBaseUrl.host + urlPath;
  return resolvedUrl;
}

function decodeBase64(enc_value) {
  const buff = Buffer.from(enc_value, 'base64');
  return buff.toString('utf-8');
}

main();
