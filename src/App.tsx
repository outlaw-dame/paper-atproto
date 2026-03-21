import React from 'react';
import {
  App,
  Page,
  Navbar,
  Block,
  Button,
  List,
  ListItem,
  BlockTitle,
} from 'konsta/react';

const PaperAppUI = () => {
  return (
    <App theme="ios">
      <Page>
        <Navbar
          title="Paper ATProto"
          subtitle="Local-first Social"
          className="top-0 sticky"
        />

        <BlockTitle>Welcome to the Future</BlockTitle>
        <Block strong inset>
          <p>
            This is a foundation for a local-first ATProto application, 
            inspired by the fluid design of Facebook Paper and built with 
            Apple's design principles in mind.
          </p>
        </Block>

        <BlockTitle>Core Features</BlockTitle>
        <List strong inset>
          <ListItem title="Local-First" footer="Offline-ready data" />
          <ListItem title="ATProto" footer="Decentralized identity" />
          <ListItem title="iOS Design" footer="Native look and feel" />
        </List>

        <Block className="space-y-2">
          <Button large rounded>Get Started</Button>
          <Button large rounded outline>Learn More</Button>
        </Block>
      </Page>
    </App>
  );
};

export default PaperAppUI;
