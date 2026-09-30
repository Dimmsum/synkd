import base from '@whosfree/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [...base, reactHooks.configs.flat['recommended-latest']];
