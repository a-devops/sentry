import React, {Fragment, useContext, useEffect} from 'react';
import {InjectedRouter} from 'react-router/lib/Router';
import styled from '@emotion/styled';
import {Location} from 'history';
import omit from 'lodash/omit';

import {addErrorMessage, addSuccessMessage} from 'app/actionCreators/indicator';
import {openDebugFileSourceModal} from 'app/actionCreators/modal';
import ProjectActions from 'app/actions/projectActions';
import {Client} from 'app/api';
import DropdownAutoComplete from 'app/components/dropdownAutoComplete';
import {Item} from 'app/components/dropdownAutoComplete/types';
import DropdownButton from 'app/components/dropdownButton';
import Link from 'app/components/links/link';
import List from 'app/components/list';
import ListItem from 'app/components/list/listItem';
import MenuItem from 'app/components/menuItem';
import {Panel, PanelBody, PanelHeader, PanelItem} from 'app/components/panels';
import AppStoreConnectContext from 'app/components/projects/appStoreConnectContext';
import {appStoreConnectAlertMessage} from 'app/components/projects/appStoreConnectContext/utils';
import {DEBUG_SOURCE_TYPES} from 'app/data/debugFileSources';
import {t, tct, tn} from 'app/locale';
import space from 'app/styles/space';
import {DebugFileSource, Organization, Project} from 'app/types';
import {defined} from 'app/utils';

import {expandKeys} from './utils';

const dropDownItems = [
  {
    value: DebugFileSource.S3,
    label: t(DEBUG_SOURCE_TYPES.s3),
    searchKey: t('aws amazon s3 bucket'),
  },
  {
    value: DebugFileSource.GCS,
    label: t(DEBUG_SOURCE_TYPES.gcs),
    searchKey: t('gcs google cloud storage bucket'),
  },
  {
    value: DebugFileSource.HTTP,
    label: t(DEBUG_SOURCE_TYPES.http),
    searchKey: t('http symbol server ssqp symstore symsrv'),
  },
];

type Props = {
  api: Client;
  organization: Organization;
  projectSlug: Project['slug'];
  symbolSources: Item[];
  router: InjectedRouter;
  location: Location;
};

function SymbolSources({
  api,
  organization,
  symbolSources,
  projectSlug,
  router,
  location,
}: Props) {
  const appStoreConnectContext = useContext(AppStoreConnectContext);

  useEffect(() => {
    openDebugFileSourceDialog();
  }, [location.query, appStoreConnectContext]);

  const hasAppConnectStoreFeatureFlag =
    !!organization.features?.includes('app-store-connect');

  if (
    hasAppConnectStoreFeatureFlag &&
    !appStoreConnectContext &&
    !dropDownItems.find(
      dropDownItem => dropDownItem.value === DebugFileSource.APP_STORE_CONNECT
    )
  ) {
    dropDownItems.push({
      value: DebugFileSource.APP_STORE_CONNECT,
      label: t(DEBUG_SOURCE_TYPES.appStoreConnect),
      searchKey: t('apple store connect itunes ios'),
    });
  }

  function getRichListFieldValue(): {
    value: Item[];
    warnings?: React.ReactNode[];
    errors?: React.ReactNode[];
  } {
    if (
      !hasAppConnectStoreFeatureFlag ||
      !appStoreConnectContext ||
      !appStoreConnectContext.updateAlertMessage
    ) {
      return {value: symbolSources};
    }

    const symbolSourcesErrors: React.ReactNode[] = [];
    const symbolSourcesWarnings: React.ReactNode[] = [];

    const symbolSourcesWithErrors = symbolSources.map(symbolSource => {
      if (symbolSource.id === appStoreConnectContext.id) {
        const appStoreConnectErrors: string[] = [];
        const customRepositoryLink = `/settings/${organization.slug}/projects/${projectSlug}/debug-symbols/?customRepository=${symbolSource.id}`;

        if (
          appStoreConnectContext.itunesSessionValid &&
          appStoreConnectContext.appstoreCredentialsValid
        ) {
          const {updateAlertMessage} = appStoreConnectContext;
          if (
            updateAlertMessage ===
            appStoreConnectAlertMessage.isTodayAfterItunesSessionRefreshAt
          ) {
            symbolSourcesWarnings.push(
              <div>
                {t('Your iTunes session will likely expire soon.')}
                &nbsp;
                {tct('We recommend that you revalidate the session for [link]', {
                  link: (
                    <Link to={`${customRepositoryLink}&revalidateItunesSession=true`}>
                      {symbolSource.name}
                    </Link>
                  ),
                })}
              </div>
            );

            return {
              ...symbolSource,
              warning: updateAlertMessage,
            };
          }
        }

        if (appStoreConnectContext.itunesSessionValid === false) {
          symbolSourcesErrors.push(
            tct('Revalidate your iTunes session for [link]', {
              link: (
                <Link to={`${customRepositoryLink}&revalidateItunesSession=true`}>
                  {symbolSource.name}
                </Link>
              ),
            })
          );

          appStoreConnectErrors.push(t('Revalidate your iTunes session'));
        }

        if (appStoreConnectContext.appstoreCredentialsValid === false) {
          symbolSourcesErrors.push(
            tct('Recheck your App Store Credentials for [link]', {
              link: <Link to={customRepositoryLink}>{symbolSource.name}</Link>,
            })
          );
          appStoreConnectErrors.push(t('Recheck your App Store Credentials'));
        }

        return {
          ...symbolSource,
          error: !!appStoreConnectErrors.length ? (
            <Fragment>
              {tn(
                'There was an error connecting to the Apple Store Connect:',
                'There were errors connecting to the Apple Store Connect:',
                appStoreConnectErrors.length
              )}
              <StyledList symbol="bullet">
                {appStoreConnectErrors.map((error, errorIndex) => (
                  <ListItem key={errorIndex}>{error}</ListItem>
                ))}
              </StyledList>
            </Fragment>
          ) : undefined,
        };
      }

      return symbolSource;
    });

    return {
      value: symbolSourcesWithErrors,
      errors: symbolSourcesErrors,
      warnings: symbolSourcesWarnings,
    };
  }

  const {value, warnings = [], errors = []} = getRichListFieldValue();

  function openDebugFileSourceDialog() {
    const {customRepository} = location.query;

    if (!customRepository) {
      return;
    }

    const itemIndex = value.findIndex(v => v.id === customRepository);
    const item = value[itemIndex];

    if (!item) {
      return;
    }

    const {_warning, _error, ...sourceConfig} = item;

    openDebugFileSourceModal({
      sourceConfig,
      sourceType: item.type,
      appStoreConnectContext,
      onSave: updatedItem =>
        persistData({updatedItem: updatedItem as Item, index: itemIndex}),
      onClose: handleCloseModal,
    });
  }

  function getRequestMessages(updatedSymbolSourcesQuantity: number) {
    if (updatedSymbolSourcesQuantity > symbolSources.length) {
      return {
        successMessage: t('Successfully added custom repository'),
        errorMessage: t('An error occurred while adding a new custom repository'),
      };
    }

    if (updatedSymbolSourcesQuantity < symbolSources.length) {
      return {
        successMessage: t('Successfully removed custom repository'),
        errorMessage: t('An error occurred while removing the custom repository'),
      };
    }

    return {
      successMessage: t('Successfully updated custom repository'),
      errorMessage: t('An error occurred while updating the custom repository'),
    };
  }

  function persistData({
    updatedItems,
    updatedItem,
    index,
  }: {
    updatedItems?: Item[];
    updatedItem?: Item;
    index?: number;
  }) {
    let items = updatedItems ?? [];

    if (updatedItem && defined(index)) {
      items = [...symbolSources] as Item[];
      items.splice(index, 1, updatedItem);
    }

    const symbolSourcesWithoutErrors = items.map(item =>
      omit(item, ['error', 'warning'])
    );

    const {successMessage, errorMessage} = getRequestMessages(items.length);

    const expandedSymbolSourceKeys = symbolSourcesWithoutErrors.map(expandKeys);

    const promise: Promise<any> = api.requestPromise(
      `/projects/${organization.slug}/${projectSlug}/`,
      {
        method: 'PUT',
        data: {
          symbolSources: JSON.stringify(expandedSymbolSourceKeys),
        },
      }
    );

    promise.catch(() => {
      addErrorMessage(errorMessage);
    });

    promise.then(result => {
      ProjectActions.updateSuccess(result);
      addSuccessMessage(successMessage);
    });

    return promise;
  }

  function handleEditModal(repositoryId: string) {
    router.push({
      ...location,
      query: {
        ...location.query,
        customRepository: repositoryId,
      },
    });
  }

  function handleCloseModal() {
    router.push({
      ...location,
      query: {
        ...location.query,
        customRepository: undefined,
        revalidateItunesSession: undefined,
      },
    });
  }

  function handleAddRepository(repoType: DebugFileSource) {
    openDebugFileSourceModal({
      sourceType: repoType,
      onSave: updatedData =>
        persistData({updatedItems: [...symbolSources, updatedData] as Item[]}),
    });
  }

  console.log('symbolSources', symbolSources);

  return (
    <Panel>
      <PanelHeader hasButtons>
        {t('Custom Repositories')}
        <DropdownAutoComplete
          items={dropDownItems.map(dropDownItem => ({
            ...dropDownItem,
            label: (
              <StyledMenuItem
                onClick={event => {
                  event.preventDefault();
                  handleAddRepository(dropDownItem.value);
                }}
              >
                {dropDownItem.label}
              </StyledMenuItem>
            ),
          }))}
        >
          {({isOpen}) => (
            <DropdownButton isOpen={isOpen} size="small">
              {t('Add Repository')}
            </DropdownButton>
          )}
        </DropdownAutoComplete>
      </PanelHeader>
      <PanelBody>
        {symbolSources.map((symbolSource, index) => (
          <PanelItem key={index}>{symbolSource.type}</PanelItem>
        ))}
      </PanelBody>
    </Panel>
  );
}

export default SymbolSources;

const StyledList = styled(List)`
  margin-top: ${space(1)};
`;

const StyledMenuItem = styled(MenuItem)`
  color: ${p => p.theme.textColor};
  font-size: ${p => p.theme.fontSizeMedium};
  font-weight: 400;
  text-transform: none;
  span {
    padding: 0;
  }
`;
