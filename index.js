#!/usr/bin/env node
const SMTPServer = require('smtp-server').SMTPServer;
const simpleParser = require('mailparser').simpleParser;
const express = require("express");
const handlebars = require('express-handlebars');
const _ = require("lodash");
const moment = require("moment");
const cli = require('cli').enable('catchall');


const config = cli.parse({
  smtpPort: ['s', 'SMTP port to listen on', 'number', 1025],
  httpPort: ['h', 'HTTP port to listen on', 'number', 1080],
  whitelist: ['w', 'Only accept e-mails from these adresses. Accepts multiple e-mails comma-separated', 'string'],
  max: ['m', 'Max number of e-mails to keep', 'number', 100]
});

const whitelist = config.whitelist ? config.whitelist.split(',') : [];

const mails = [];

const server = new SMTPServer({
  authOptional: true,
  onMailFrom(address, session, cb) {
    if (whitelist.length == 0 || whitelist.indexOf(address.address) !== -1) {
      cb();
    } else {
      cb(new Error('Invalid email from: ' + address.address));
    }
  },
  onData(stream, session, callback) {
    simpleParser(stream).then(
      mail => {
        cli.debug(JSON.stringify(mail));

        mails.unshift(mail);

        //trim list of emails if necessary
        while (mails.length > config.max) {
          mails.pop();
        }

        callback();
      },
      callback
    );
  }
});

server.on('error', err => {
  cli.error(err);
});

server.listen(config.smtpPort);

const app = express();

function emailFilter(filter) {
  return email => {
    if (filter.since || filter.until) {
      const date = moment(email.date);
      if (filter.since && date.isBefore(filter.since)) {
        return false;
      }
      if (filter.until && date.isAfter(filter.until)) {
        return false;
      }
    }

    if (filter.to && _.every(email.to.value, to => to.address !== filter.to)) {
      return false;
    }

    if (filter.from && _.every(email.from.value, from => from.address !== filter.from)) {
      return false;
    }

    return true;
  }
}

function getEmails(filter) {
  return mails.filter(emailFilter(filter))
}

function getEmailsTo(address, filter) {
  const fullFilter = _.clone(filter);
  fullFilter.to = address;
  return getEmails(fullFilter);
}

app.set('views', './views');

app.engine('handlebars', handlebars({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');

function renderHtml(res, emails) {
  res.render('emails', { emails });
}

app.get('/emails', (req, res) => {
  renderHtml(res, getEmails(req.query));
});

app.get('/emails/:address', (req, res) => {
  renderHtml(res, getEmailsTo(req.params.address, req.query));
});

app.get('/api/emails', (req, res) => {
  res.json(getEmails(req.query));
});

app.get('/api/emails/:address', (req, res) => {
  res.json(getEmailsTo(req.params.address, req.query));
});

app.listen(config.httpPort, () => {
  cli.info("HTTP server listening on port " + config.httpPort + ", e-mails are available on /emails.");
});

cli.info("SMTP server listening on port " + config.smtpPort);
